//! Arrastre directo en Windows con archivos virtuales. ⚠️ Experimental: compila en la CI pero
//! no se probó con un Explorador real.
//!
//! Un objeto de datos propio (`data_object`) con la lista y el contenido, y `SHDoDragDrop` como
//! en `dragout/win.rs`. Sin la envoltura del Shell (`SHCreateDataObject`) a propósito: es la
//! forma clásica de los ejemplos de archivos virtuales y la más probable que funcione a la
//! primera; a cambio no hay imagen de arrastre (solo el cursor de copiar), porque el objeto no
//! guarda formatos ajenos con `SetData`.
//! Al soltar, el Explorador lee cada archivo con `IStream::Read` en este mismo hilo (el de la
//! ventana); cada lectura espera a SFTP, así que la ventana puede ir a tirones mientras copia.

mod com;
mod data_object;
mod descriptor;
mod stream;

use tauri::WebviewWindow;
use windows::Win32::System::Ole::{DROPEFFECT_COPY, DROPEFFECT_NONE, IDropSource, OleInitialize};
use windows::Win32::UI::Shell::SHDoDragDrop;

use super::DirectSet;
use crate::dragout::Done;
use crate::error::{AppError, AppResult};

pub fn start(window: &WebviewWindow, set: DirectSet, done: Done) -> AppResult<()> {
    let win = window.clone();
    window
        .run_on_main_thread(move || {
            // SAFETY: se ejecuta en el hilo de la ventana (STA, con su bucle de mensajes).
            let r = unsafe { drag(&win, set) };
            done(r);
        })
        .map_err(|e| AppError::Invalid(format!("No se pudo empezar a arrastrar: {e}")))
}

unsafe fn drag(win: &WebviewWindow, set: DirectSet) -> Result<bool, String> {
    let hwnd = win.hwnd().map_err(|e| e.to_string())?;
    // SAFETY: inicialización de OLE en el hilo actual (repetirla solo suma una referencia).
    let _ = unsafe { OleInitialize(None) };
    let data = data_object::new(set).map_err(|e| e.message())?;
    // SAFETY: `data` vive durante todo el arrastre (bucle modal que vuelve al soltar).
    let effect = unsafe { SHDoDragDrop(Some(hwnd), &data, None::<&IDropSource>, DROPEFFECT_COPY) }.map_err(|e| e.message())?;
    Ok(effect != DROPEFFECT_NONE)
}
