use std::collections::HashMap;
use std::future::Future;
use std::io::{Cursor, SeekFrom};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::jobs::{JobSink, Jobs};
use super::list::{collect, unix_to_filetime, wide_name, RemoteItem, RemoteTree, MAX_ENTRIES, NAME_UNITS};
use super::reader::{BlockingReader, Chunk, Opener, Track, PIECE};
use crate::error::{AppError, AppResult};
use crate::transfer::paths::RemoteKind;
use crate::types::{TransferJob, TransferStatus};

// ───────────────────────── Lista ─────────────────────────

/// Servidor falso: ruta → (tipo, tamaño, contenido si es carpeta).
#[derive(Default)]
struct FakeTree {
    items: HashMap<String, (RemoteKind, u64, Vec<String>)>,
}

impl FakeTree {
    fn add(mut self, path: &str, kind: RemoteKind, size: u64, children: &[&str]) -> Self {
        self.items.insert(path.into(), (kind, size, children.iter().map(|s| s.to_string()).collect()));
        self
    }
    fn item(&self, path: &str) -> AppResult<RemoteItem> {
        let (kind, size, _) = self.items.get(path).ok_or_else(|| AppError::NotFound(path.into()))?;
        let name = path.rsplit('/').next().unwrap_or("").to_string();
        Ok(RemoteItem { name, kind: *kind, size: *size, modified: Some(1_700_000_000) })
    }
}

impl RemoteTree for FakeTree {
    fn stat(&self, path: &str) -> impl Future<Output = AppResult<RemoteItem>> + Send {
        let r = self.item(path).map(|mut i| {
            // Los enlaces de este servidor falso apuntan a `<ruta>.destino`.
            if i.kind == RemoteKind::Link {
                let t = self.item(&format!("{path}.destino")).ok();
                i.kind = t.as_ref().map_or(RemoteKind::Other, |t| t.kind);
                i.size = t.map_or(0, |t| t.size);
            }
            i
        });
        async move { r }
    }
    fn list(&self, path: &str) -> impl Future<Output = AppResult<Vec<RemoteItem>>> + Send {
        let r = self.items.get(path).map(|(_, _, kids)| {
            kids.iter().filter_map(|k| self.item(&format!("{path}/{k}")).ok().map(|mut i| {
                i.name = k.clone();
                i
            })).collect()
        });
        async move { r.ok_or_else(|| AppError::NotFound("carpeta".into())) }
    }
}

fn block<T>(f: impl Future<Output = T>) -> T {
    tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(f)
}

#[test]
fn lista_carpetas_antes_que_su_contenido_con_nombres_de_windows() {
    let tree = FakeTree::default()
        .add("/srv/fotos", RemoteKind::Dir, 0, &["viaje", "a:b?.jpg", "CON.txt", "enlace", "enlace-carpeta", "socket"])
        .add("/srv/fotos/viaje", RemoteKind::Dir, 0, &["x.jpg"])
        .add("/srv/fotos/viaje/x.jpg", RemoteKind::File, 10, &[])
        .add("/srv/fotos/a:b?.jpg", RemoteKind::File, 3, &[])
        .add("/srv/fotos/CON.txt", RemoteKind::File, 1, &[])
        .add("/srv/fotos/enlace", RemoteKind::Link, 0, &[])
        .add("/srv/fotos/enlace.destino", RemoteKind::File, 7, &[])
        .add("/srv/fotos/enlace-carpeta", RemoteKind::Link, 0, &[])
        .add("/srv/fotos/enlace-carpeta.destino", RemoteKind::Dir, 0, &[])
        .add("/srv/fotos/socket", RemoteKind::Other, 0, &[])
        .add("/srv/nota.txt", RemoteKind::File, 5, &[]);
    let list = block(collect(&tree, &["/srv/fotos".into(), "/srv/nota.txt".into()])).unwrap();
    let rels: Vec<&str> = list.iter().map(|e| e.rel.as_str()).collect();
    assert_eq!(rels, ["fotos", "nota.txt", "fotos\\viaje", "fotos\\a_b_.jpg", "fotos\\_CON.txt", "fotos\\enlace", "fotos\\viaje\\x.jpg"]);
    assert!(list[0].is_dir && list[2].is_dir && !list[1].is_dir);
    // El enlace a archivo lleva el tamaño del destino; el enlace a carpeta y el socket no van.
    assert_eq!(list[5].size, 7);
    assert_eq!(list[6].remote, "/srv/fotos/viaje/x.jpg");
    assert_eq!(list[6].modified, Some(1_700_000_000));
}

#[test]
fn nombres_que_solo_cambian_en_mayusculas_se_numeran() {
    let tree = FakeTree::default()
        .add("/d", RemoteKind::Dir, 0, &["Informe.txt", "informe.txt", "INFORME.TXT"])
        .add("/d/Informe.txt", RemoteKind::File, 1, &[])
        .add("/d/informe.txt", RemoteKind::File, 1, &[])
        .add("/d/INFORME.TXT", RemoteKind::File, 1, &[]);
    let list = block(collect(&tree, &["/d".into()])).unwrap();
    let rels: Vec<&str> = list.iter().map(|e| e.rel.as_str()).collect();
    assert_eq!(rels, ["d", "d\\Informe.txt", "d\\informe (2).txt", "d\\INFORME (3).TXT"]);
}

#[test]
fn demasiados_elementos_o_rutas_largas_fallan_para_volver_al_camino_de_siempre() {
    let names: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("f{i}")).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let mut tree = FakeTree::default().add("/big", RemoteKind::Dir, 0, &refs);
    for n in &names {
        tree = tree.add(&format!("/big/{n}"), RemoteKind::File, 1, &[]);
    }
    assert!(matches!(block(collect(&tree, &["/big".into()])), Err(AppError::Invalid(_))));

    let long = "a".repeat(NAME_UNITS);
    let tree = FakeTree::default().add(&format!("/{long}"), RemoteKind::File, 1, &[]);
    assert!(matches!(block(collect(&tree, &[format!("/{long}")])), Err(AppError::Invalid(_))));
}

#[test]
fn nombre_ancho_y_fecha_de_windows() {
    let w = wide_name("ñ\\a").unwrap();
    assert_eq!(&w[..4], &[0xF1, u16::from(b'\\'), u16::from(b'a'), 0]);
    assert!(wide_name(&"x".repeat(NAME_UNITS - 1)).is_some());
    assert!(wide_name(&"x".repeat(NAME_UNITS)).is_none());
    assert_eq!(unix_to_filetime(0), 116_444_736_000_000_000);
}

// ───────────────────────── Progreso ─────────────────────────

#[derive(Default)]
struct Sink {
    updates: Mutex<Vec<TransferJob>>,
    removed: Mutex<Vec<String>>,
}

impl JobSink for Sink {
    fn update(&self, jobs: Vec<TransferJob>) {
        self.updates.lock().unwrap().extend(jobs);
    }
    fn removed(&self, ids: Vec<String>) {
        self.removed.lock().unwrap().extend(ids);
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap()
}

#[test]
fn progreso_cancelar_y_limpiar_desde_el_panel() {
    let rt = runtime();
    let sink = Arc::new(Sink::default());
    let jobs = Jobs::new(rt.handle().clone(), sink.clone());
    let a = jobs.add("lote", "s1", "fotos/a.jpg", "/srv/fotos/a.jpg", 100);
    let b = jobs.add("lote", "s1", "fotos/b.jpg", "/srv/fotos/b.jpg", 100);
    // El aviso de que existen lo da el contador (no el hilo que los pide).
    assert!(jobs.tick(500));
    assert_eq!(sink.updates.lock().unwrap().len(), 2);

    a.reach(40);
    assert!(jobs.tick(1_000));
    let last = sink.updates.lock().unwrap().last().cloned().unwrap();
    assert_eq!((last.transferred, last.status), (40, TransferStatus::Running));
    assert_eq!(last.name, "fotos/a.jpg");

    a.reach(100);
    jobs.cancel(&["lote".into()]);
    assert!(b.token.is_cancelled());
    assert!(!jobs.tick(1_200), "ya no queda nada en marcha");
    let ups = sink.updates.lock().unwrap().clone();
    let status = |id: &str| ups.iter().rev().find(|j| j.id == id).map(|j| j.status);
    assert_eq!(status(&ups[0].id), Some(TransferStatus::Done));
    assert_eq!(status(&ups[1].id), Some(TransferStatus::Canceled));

    jobs.clear_finished(1_300);
    assert_eq!(sink.removed.lock().unwrap().len(), 2);
}

// ───────────────────────── Lector ─────────────────────────

fn reader_over(data: Vec<u8>, jobs: &Arc<Jobs>, opens: Arc<AtomicUsize>) -> BlockingReader<Cursor<Vec<u8>>> {
    let size = data.len() as u64;
    let opener: Opener<Cursor<Vec<u8>>> = Box::new(move || {
        opens.fetch_add(1, Ordering::SeqCst);
        let data = data.clone();
        Box::pin(async move { Ok(Cursor::new(data)) })
    });
    let j = jobs.clone();
    let track: Track = Box::new(move || j.add("lote", "s1", "a.bin", "/a.bin", size));
    BlockingReader::new(jobs_rt_handle(), opener, size, track)
}

thread_local! {
    /// Tokio de cada prueba; las lecturas se hacen desde el hilo de la prueba (como el sistema).
    static RT: tokio::runtime::Runtime = runtime();
}

#[test]
fn lee_por_trozos_abre_en_la_primera_lectura_y_avisa_al_final() {
    let sink = Arc::new(Sink::default());
    let jobs = Jobs::new(jobs_rt_handle(), sink.clone());
    let opens = Arc::new(AtomicUsize::new(0));
    let data: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
    let r = reader_over(data.clone(), &jobs, opens.clone());
    assert_eq!(opens.load(Ordering::SeqCst), 0, "no se abre hasta leer");
    assert!(sink.updates.lock().unwrap().is_empty(), "no se ve en el panel hasta leer");

    let mut buf = vec![0u8; 600];
    assert_eq!(r.read(&mut buf).unwrap(), Chunk { len: 600, eof: false });
    assert_eq!(&buf[..], &data[..600]);
    assert_eq!(r.read(&mut buf).unwrap(), Chunk { len: 400, eof: true });
    assert_eq!(&buf[..400], &data[600..]);
    assert_eq!(r.read(&mut buf).unwrap(), Chunk { len: 0, eof: true });

    // Volver atrás y releer: busca en el archivo ya abierto.
    assert_eq!(r.seek(SeekFrom::Start(10)).unwrap(), 10);
    assert_eq!(r.seek(SeekFrom::Current(5)).unwrap(), 15);
    let mut small = [0u8; 4];
    assert_eq!(r.read(&mut small).unwrap().len, 4);
    assert_eq!(&small, &data[15..19]);
    assert_eq!(r.seek(SeekFrom::End(-1)).unwrap(), 999);
    assert!(r.seek(SeekFrom::Current(-5000)).is_err());
    assert_eq!(opens.load(Ordering::SeqCst), 1);

    drop(r);
    jobs.tick(10_000);
    let last = sink.updates.lock().unwrap().last().cloned().unwrap();
    assert_eq!((last.status, last.transferred), (TransferStatus::Done, 1000));
}

#[test]
fn una_lectura_grande_se_llena_entera_por_trozos() {
    let sink = Arc::new(Sink::default());
    let jobs = Jobs::new(jobs_rt_handle(), sink);
    let size = PIECE * 5 / 2;
    let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    let r = reader_over(data.clone(), &jobs, Arc::new(AtomicUsize::new(0)));
    let mut buf = vec![0u8; PIECE * 2];
    assert_eq!(r.read(&mut buf).unwrap(), Chunk { len: PIECE * 2, eof: false });
    assert_eq!(&buf[..], &data[..PIECE * 2]);
    assert_eq!(r.read(&mut buf).unwrap(), Chunk { len: size - PIECE * 2, eof: true });
    assert_eq!(&buf[..size - PIECE * 2], &data[PIECE * 2..]);
}

#[test]
fn cancelar_corta_la_lectura_y_queda_cancelado() {
    let sink = Arc::new(Sink::default());
    let jobs = Jobs::new(jobs_rt_handle(), sink.clone());
    let r = reader_over(vec![7u8; 100], &jobs, Arc::new(AtomicUsize::new(0)));
    let mut buf = [0u8; 10];
    assert_eq!(r.read(&mut buf).unwrap().len, 10);
    jobs.cancel(&["lote".into()]);
    let err = r.read(&mut buf).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::Interrupted);
    drop(r);
    jobs.tick(10_000);
    let last = sink.updates.lock().unwrap().last().cloned().unwrap();
    assert_eq!(last.status, TransferStatus::Canceled);
}

#[test]
fn un_error_al_abrir_queda_como_error_en_el_panel() {
    let sink = Arc::new(Sink::default());
    let jobs = Jobs::new(jobs_rt_handle(), sink.clone());
    let opener: Opener<Cursor<Vec<u8>>> = Box::new(|| Box::pin(async { Err(std::io::Error::other("Permiso denegado")) }));
    let j = jobs.clone();
    let track: Track = Box::new(move || j.add("lote", "s1", "a.bin", "/a.bin", 5));
    let r = BlockingReader::new(jobs_rt_handle(), opener, 5, track);
    assert!(r.read(&mut [0u8; 5]).is_err());
    drop(r);
    jobs.tick(10_000);
    let last = sink.updates.lock().unwrap().last().cloned().unwrap();
    assert_eq!((last.status, last.error.as_deref()), (TransferStatus::Error, Some("Permiso denegado")));
}

fn jobs_rt_handle() -> tokio::runtime::Handle {
    RT.with(|rt| rt.handle().clone())
}
