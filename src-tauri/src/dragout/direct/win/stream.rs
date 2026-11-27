//! `IStream` de solo lectura sobre un archivo remoto: el Explorador lo lee al soltar
//! (`CFSTR_FILECONTENTS`) y cada `Read` se hace por SFTP (`BlockingReader`).

use std::ffi::c_void;
use std::io::{self, SeekFrom};
use std::sync::atomic::AtomicU32;

use russh_sftp::client::fs::File;
use windows::core::{Interface, GUID, HRESULT};
use windows::Win32::Foundation::{E_ABORT, E_NOTIMPL, STG_E_ACCESSDENIED, STG_E_INVALIDFUNCTION, STG_E_INVALIDPOINTER, STG_E_READFAULT, S_FALSE, S_OK};
use windows::Win32::System::Com::{
    ISequentialStream, ISequentialStream_Vtbl, IStream, IStream_Vtbl, STATFLAG_NONAME, STATSTG, STGM_READ, STGTY_STREAM, STREAM_SEEK,
    STREAM_SEEK_CUR, STREAM_SEEK_END, STREAM_SEEK_SET,
};

use super::com::{co_task_string, filetime, into_interface, this_ref, unknown_vtbl, ComObject};
use crate::dragout::direct::reader::BlockingReader;

/// Trozo de `CopyTo` (cuando el destino pide copiar a otro flujo en vez de leer).
const COPY_CHUNK: usize = 1024 * 1024;

#[repr(C)]
struct Stream {
    vtbl: &'static IStream_Vtbl,
    refs: AtomicU32,
    reader: BlockingReader<File>,
    /// Nombre del archivo (para `Stat`).
    name: String,
    modified: Option<u64>,
}

// SAFETY: `Stream` es `#[repr(C)]` con `vtbl` primero y se crea con `into_interface`.
unsafe impl ComObject for Stream {
    const IIDS: &'static [GUID] = &[ISequentialStream::IID, IStream::IID];
    fn refs(&self) -> &AtomicU32 {
        &self.refs
    }
}

static VTBL: IStream_Vtbl = IStream_Vtbl {
    base__: ISequentialStream_Vtbl { base__: unknown_vtbl::<Stream>(), Read: read, Write: write },
    Seek: seek,
    SetSize: set_size,
    CopyTo: copy_to,
    Commit: commit,
    Revert: not_impl,
    LockRegion: region,
    UnlockRegion: region,
    Stat: stat,
    Clone: clone,
};

/// Flujo COM nuevo (con una referencia) sobre `reader`.
pub fn new(reader: BlockingReader<File>, name: String, modified: Option<u64>) -> IStream {
    let obj = Stream { vtbl: &VTBL, refs: AtomicU32::new(1), reader, name, modified };
    // SAFETY: `VTBL` es la tabla de `IStream`.
    unsafe { into_interface(obj) }
}

fn error_hr(e: &io::Error) -> HRESULT {
    if e.kind() == io::ErrorKind::Interrupted { E_ABORT } else { STG_E_READFAULT }
}

unsafe extern "system" fn read(this: *mut c_void, pv: *mut c_void, cb: u32, pcbread: *mut u32) -> HRESULT {
    if pv.is_null() {
        return STG_E_INVALIDPOINTER;
    }
    // SAFETY: `this` es un `Stream` vivo; `pv` apunta a `cb` bytes que se pueden escribir.
    let (me, buf) = unsafe { (this_ref::<Stream>(this), std::slice::from_raw_parts_mut(pv.cast::<u8>(), cb as usize)) };
    let (n, hr) = match me.reader.read(buf) {
        Ok(c) => (c.len as u32, if c.eof && (c.len as u32) < cb { S_FALSE } else { S_OK }),
        Err(e) => (0, error_hr(&e)),
    };
    if !pcbread.is_null() {
        // SAFETY: puntero de salida no nulo que da quien llama.
        unsafe { *pcbread = n };
    }
    hr
}

unsafe extern "system" fn write(_this: *mut c_void, _pv: *const c_void, _cb: u32, pcbwritten: *mut u32) -> HRESULT {
    if !pcbwritten.is_null() {
        // SAFETY: puntero de salida no nulo que da quien llama.
        unsafe { *pcbwritten = 0 };
    }
    STG_E_ACCESSDENIED
}

unsafe extern "system" fn seek(this: *mut c_void, dlibmove: i64, origin: STREAM_SEEK, newpos: *mut u64) -> HRESULT {
    // SAFETY: `this` es un `Stream` vivo.
    let me = unsafe { this_ref::<Stream>(this) };
    let to = match origin {
        STREAM_SEEK_SET => match u64::try_from(dlibmove) {
            Ok(p) => SeekFrom::Start(p),
            Err(_) => return STG_E_INVALIDFUNCTION,
        },
        STREAM_SEEK_CUR => SeekFrom::Current(dlibmove),
        STREAM_SEEK_END => SeekFrom::End(dlibmove),
        _ => return STG_E_INVALIDFUNCTION,
    };
    match me.reader.seek(to) {
        Ok(p) => {
            if !newpos.is_null() {
                // SAFETY: puntero de salida no nulo que da quien llama.
                unsafe { *newpos = p };
            }
            S_OK
        }
        Err(_) => STG_E_INVALIDFUNCTION,
    }
}

unsafe extern "system" fn set_size(_this: *mut c_void, _size: u64) -> HRESULT {
    STG_E_ACCESSDENIED
}

/// Copia `cb` bytes a otro flujo (`pstm`), leyendo por trozos.
unsafe extern "system" fn copy_to(this: *mut c_void, pstm: *mut c_void, cb: u64, pcbread: *mut u64, pcbwritten: *mut u64) -> HRESULT {
    // SAFETY: `this` es un `Stream` vivo; `pstm` es un `IStream` prestado durante la llamada.
    let (me, dest) = unsafe { (this_ref::<Stream>(this), IStream::from_raw_borrowed(&pstm)) };
    let Some(dest) = dest else { return STG_E_INVALIDPOINTER };
    let mut buf = vec![0u8; COPY_CHUNK];
    let (mut total_read, mut total_written, mut hr) = (0u64, 0u64, S_OK);
    while total_read < cb {
        let want = (cb - total_read).min(COPY_CHUNK as u64) as usize;
        let chunk = match me.reader.read(&mut buf[..want]) {
            Ok(c) => c,
            Err(e) => {
                hr = error_hr(&e);
                break;
            }
        };
        total_read += chunk.len as u64;
        let mut written = 0u32;
        // SAFETY: `buf` tiene `chunk.len` bytes válidos; `written` vive durante la llamada.
        let w = unsafe { dest.Write(buf.as_ptr().cast(), chunk.len as u32, Some(&raw mut written)) };
        total_written += u64::from(written);
        if w.is_err() {
            hr = w;
            break;
        }
        if chunk.eof || chunk.len == 0 {
            break;
        }
    }
    // SAFETY: punteros de salida no nulos que da quien llama.
    unsafe {
        if !pcbread.is_null() {
            *pcbread = total_read;
        }
        if !pcbwritten.is_null() {
            *pcbwritten = total_written;
        }
    }
    hr
}

/// Solo lectura: no hay nada que confirmar.
unsafe extern "system" fn commit(_this: *mut c_void, _flags: u32) -> HRESULT {
    S_OK
}

unsafe extern "system" fn not_impl(_this: *mut c_void) -> HRESULT {
    E_NOTIMPL
}

unsafe extern "system" fn region(_this: *mut c_void, _offset: u64, _cb: u64, _kind: u32) -> HRESULT {
    STG_E_INVALIDFUNCTION
}

unsafe extern "system" fn stat(this: *mut c_void, out: *mut STATSTG, flags: u32) -> HRESULT {
    if out.is_null() {
        return STG_E_INVALIDPOINTER;
    }
    // SAFETY: `this` es un `Stream` vivo.
    let me = unsafe { this_ref::<Stream>(this) };
    let mut st = STATSTG {
        r#type: STGTY_STREAM.0 as u32,
        cbSize: me.reader.size(),
        mtime: filetime(me.modified),
        grfMode: STGM_READ,
        ..Default::default()
    };
    if flags & (STATFLAG_NONAME.0 as u32) == 0 {
        st.pwcsName = co_task_string(&me.name);
    }
    // SAFETY: `out` no es nulo y apunta a un `STATSTG` que rellena quien llama.
    unsafe { out.write(st) };
    S_OK
}

unsafe extern "system" fn clone(_this: *mut c_void, out: *mut *mut c_void) -> HRESULT {
    if !out.is_null() {
        // SAFETY: puntero de salida no nulo que da quien llama.
        unsafe { *out = std::ptr::null_mut() };
    }
    E_NOTIMPL
}
