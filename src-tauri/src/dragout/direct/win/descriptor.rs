//! `CFSTR_FILEDESCRIPTORW`: la lista de archivos y carpetas en un `HGLOBAL`
//! (`FILEGROUPDESCRIPTORW` = cuántos + un `FILEDESCRIPTORW` por elemento).

use std::mem::{offset_of, size_of};

use windows::core::Result;
use windows::Win32::Foundation::{GlobalFree, E_INVALIDARG, E_OUTOFMEMORY, HGLOBAL};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND};
use windows::Win32::UI::Shell::{
    FD_ATTRIBUTES, FD_FILESIZE, FD_PROGRESSUI, FD_UNICODE, FD_WRITESTIME, FILEDESCRIPTORW, FILEGROUPDESCRIPTORW,
};

use super::com::filetime;
use crate::dragout::direct::list::{wide_name, VirtualEntry};

fn descriptor(e: &VirtualEntry) -> Option<FILEDESCRIPTORW> {
    let mut flags = FD_ATTRIBUTES.0 | FD_PROGRESSUI.0 | FD_UNICODE.0;
    if !e.is_dir {
        flags |= FD_FILESIZE.0;
    }
    if e.modified.is_some() {
        flags |= FD_WRITESTIME.0;
    }
    Some(FILEDESCRIPTORW {
        dwFlags: flags as u32,
        dwFileAttributes: if e.is_dir { FILE_ATTRIBUTE_DIRECTORY.0 } else { FILE_ATTRIBUTE_NORMAL.0 },
        ftLastWriteTime: filetime(e.modified),
        nFileSizeHigh: (e.size >> 32) as u32,
        nFileSizeLow: e.size as u32,
        cFileName: wide_name(&e.rel)?,
        ..Default::default()
    })
}

/// `HGLOBAL` nuevo con la lista (lo libera quien lo recibe, con `ReleaseStgMedium`).
pub fn group(entries: &[VirtualEntry]) -> Result<HGLOBAL> {
    let descs: Vec<FILEDESCRIPTORW> = entries.iter().map(descriptor).collect::<Option<_>>().ok_or(E_INVALIDARG)?;
    let head = offset_of!(FILEGROUPDESCRIPTORW, fgd);
    let bytes = head + descs.len() * size_of::<FILEDESCRIPTORW>();
    // SAFETY: se reserva `bytes` (a cero), se escribe dentro de ese tamaño y se suelta el bloqueo.
    unsafe {
        let h = GlobalAlloc(GHND, bytes)?;
        let p = GlobalLock(h).cast::<u8>();
        if p.is_null() {
            let _ = GlobalFree(Some(h));
            return Err(E_OUTOFMEMORY.into());
        }
        p.cast::<u32>().write_unaligned(descs.len() as u32);
        std::ptr::copy_nonoverlapping(descs.as_ptr(), p.add(head).cast::<FILEDESCRIPTORW>(), descs.len());
        // Devuelve "error" cuando el bloqueo llega a cero, que es lo normal aquí.
        let _ = GlobalUnlock(h);
        Ok(h)
    }
}
