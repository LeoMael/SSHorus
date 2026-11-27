//! Lo común de los objetos COM hechos a mano: cuenta de referencias e `IUnknown`.
//!
//! No se usa la macro `#[implement]` de `windows` porque su código generado nombra al crate
//! `windows_core`, que no es dependencia directa (y no se añaden dependencias). Cada objeto es
//! un `#[repr(C)]` cuyo primer campo es el puntero a su tabla de funciones (`vtbl`).

use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{Interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, PWSTR};
use windows::Win32::Foundation::{E_NOINTERFACE, E_POINTER, FILETIME, S_OK};
use windows::Win32::System::Com::CoTaskMemAlloc;

use crate::dragout::direct::list::unix_to_filetime;

/// Objeto COM hecho a mano.
///
/// # Safety
/// El tipo debe ser `#[repr(C)]` con el puntero a la tabla como primer campo, y vivir en una
/// `Box` creada con [`into_interface`].
pub unsafe trait ComObject: Sized {
    /// Interfaces que responde `QueryInterface`, además de `IUnknown`.
    const IIDS: &'static [GUID];
    fn refs(&self) -> &AtomicU32;
}

/// El objeto detrás de un `this` de COM.
///
/// # Safety
/// `this` debe ser un puntero a `T` creado con [`into_interface`] y todavía vivo.
pub unsafe fn this_ref<'a, T: ComObject>(this: *mut c_void) -> &'a T {
    unsafe { &*(this as *const T) }
}

unsafe extern "system" fn query_interface<T: ComObject>(this: *mut c_void, iid: *const GUID, out: *mut *mut c_void) -> HRESULT {
    if out.is_null() || iid.is_null() {
        return E_POINTER;
    }
    // SAFETY: COM pasa punteros válidos (comprobados arriba que no son nulos).
    unsafe {
        let iid = &*iid;
        if *iid == IUnknown::IID || T::IIDS.contains(iid) {
            add_ref::<T>(this);
            *out = this;
            S_OK
        } else {
            *out = std::ptr::null_mut();
            E_NOINTERFACE
        }
    }
}

unsafe extern "system" fn add_ref<T: ComObject>(this: *mut c_void) -> u32 {
    // SAFETY: `this` es un `T` vivo (lo garantiza quien llama por COM).
    unsafe { this_ref::<T>(this) }.refs().fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn release<T: ComObject>(this: *mut c_void) -> u32 {
    // SAFETY: `this` es un `T` vivo; con la última referencia se libera su `Box`.
    unsafe {
        let left = this_ref::<T>(this).refs().fetch_sub(1, Ordering::AcqRel) - 1;
        if left == 0 {
            drop(Box::from_raw(this as *mut T));
        }
        left
    }
}

/// Tabla de `IUnknown` para `T`.
pub const fn unknown_vtbl<T: ComObject>() -> IUnknown_Vtbl {
    IUnknown_Vtbl { QueryInterface: query_interface::<T>, AddRef: add_ref::<T>, Release: release::<T> }
}

/// Pasa `obj` (con su cuenta en 1) al montón y lo devuelve como la interfaz `I`.
///
/// # Safety
/// La tabla de `obj` debe ser la de `I` (o empezar como ella).
pub unsafe fn into_interface<T: ComObject, I: Interface>(obj: T) -> I {
    // SAFETY: el puntero apunta a un objeto COM válido con una referencia, que pasa a `I`.
    unsafe { I::from_raw(Box::into_raw(Box::new(obj)) as *mut c_void) }
}

/// Unix segundos → `FILETIME` (0 si no se sabe).
pub fn filetime(secs: Option<u64>) -> FILETIME {
    let t = secs.map(unix_to_filetime).unwrap_or(0);
    FILETIME { dwLowDateTime: t as u32, dwHighDateTime: (t >> 32) as u32 }
}

/// Copia `s` en memoria de COM (la libera quien la recibe con `CoTaskMemFree`).
pub fn co_task_string(s: &str) -> PWSTR {
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: se reserva justo lo que se copia; si falla, se devuelve nulo.
    unsafe {
        let p = CoTaskMemAlloc(wide.len() * 2).cast::<u16>();
        if !p.is_null() {
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
        }
        PWSTR(p)
    }
}
