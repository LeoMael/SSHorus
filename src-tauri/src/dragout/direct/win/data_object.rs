//! `IDataObject` con los dos formatos de los archivos virtuales:
//! - `CFSTR_FILEDESCRIPTORW` (`HGLOBAL`): nombres, tamaños, fechas y carpetas.
//! - `CFSTR_FILECONTENTS` (`IStream`, `lindex` = posición en la lista): el contenido de cada
//!   archivo, leído por SFTP cuando el Explorador lo pide.
//!
//! `SetData` no guarda nada (sin imagen de arrastre; ver `win/mod.rs`).

use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::sync::atomic::AtomicU32;

use windows::core::{Interface, BOOL, GUID, HRESULT};
use windows::Win32::Foundation::{
    DV_E_FORMATETC, DV_E_LINDEX, DV_E_TYMED, E_FAIL, E_INVALIDARG, E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED, S_OK,
};
use windows::Win32::System::Com::{
    IDataObject, IDataObject_Vtbl, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL, TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::UI::Shell::{SHCreateStdEnumFmtEtc, CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW};

use super::com::{into_interface, this_ref, unknown_vtbl, ComObject};
use super::{descriptor, stream};
use crate::dragout::direct::DirectSet;

#[repr(C)]
struct DataObject {
    vtbl: &'static IDataObject_Vtbl,
    refs: AtomicU32,
    set: DirectSet,
    cf_descriptor: u16,
    cf_contents: u16,
}

// SAFETY: `DataObject` es `#[repr(C)]` con `vtbl` primero y se crea con `into_interface`.
unsafe impl ComObject for DataObject {
    const IIDS: &'static [GUID] = &[IDataObject::IID];
    fn refs(&self) -> &AtomicU32 {
        &self.refs
    }
}

static VTBL: IDataObject_Vtbl = IDataObject_Vtbl {
    base__: unknown_vtbl::<DataObject>(),
    GetData: get_data,
    GetDataHere: get_data_here,
    QueryGetData: query_get_data,
    GetCanonicalFormatEtc: canonical,
    SetData: set_data,
    EnumFormatEtc: enum_format_etc,
    DAdvise: d_advise,
    DUnadvise: d_unadvise,
    EnumDAdvise: enum_d_advise,
};

/// Objeto de datos nuevo (con una referencia) para `set`.
pub fn new(set: DirectSet) -> windows::core::Result<IDataObject> {
    // SAFETY: las constantes son cadenas terminadas en cero.
    let (desc, contents) = unsafe { (RegisterClipboardFormatW(CFSTR_FILEDESCRIPTORW), RegisterClipboardFormatW(CFSTR_FILECONTENTS)) };
    let (Ok(cf_descriptor), Ok(cf_contents)) = (u16::try_from(desc), u16::try_from(contents)) else {
        return Err(E_FAIL.into());
    };
    if cf_descriptor == 0 || cf_contents == 0 {
        return Err(E_FAIL.into());
    }
    let obj = DataObject { vtbl: &VTBL, refs: AtomicU32::new(1), set, cf_descriptor, cf_contents };
    // SAFETY: `VTBL` es la tabla de `IDataObject`.
    Ok(unsafe { into_interface(obj) })
}

/// Qué formato pide el sistema.
enum Offer {
    Descriptor,
    /// Contenido del elemento `i`, o de cualquiera (`None`, `lindex = -1`, solo para preguntar).
    Contents(Option<usize>),
}

impl DataObject {
    fn offer(&self, f: &FORMATETC) -> Result<Offer, HRESULT> {
        if f.dwAspect != DVASPECT_CONTENT.0 {
            return Err(DV_E_FORMATETC);
        }
        if f.cfFormat == self.cf_descriptor {
            return if f.tymed & TYMED_HGLOBAL.0 as u32 != 0 { Ok(Offer::Descriptor) } else { Err(DV_E_TYMED) };
        }
        if f.cfFormat != self.cf_contents {
            return Err(DV_E_FORMATETC);
        }
        if f.tymed & TYMED_ISTREAM.0 as u32 == 0 {
            return Err(DV_E_TYMED);
        }
        if f.lindex == -1 {
            return Ok(Offer::Contents(None));
        }
        usize::try_from(f.lindex)
            .ok()
            .filter(|&i| self.set.entries.get(i).is_some_and(|e| !e.is_dir))
            .map(|i| Offer::Contents(Some(i)))
            .ok_or(DV_E_LINDEX)
    }

    fn formats(&self) -> [FORMATETC; 2] {
        let f = |cf, tymed: i32| FORMATETC { cfFormat: cf, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: tymed as u32 };
        [f(self.cf_descriptor, TYMED_HGLOBAL.0), f(self.cf_contents, TYMED_ISTREAM.0)]
    }
}

unsafe extern "system" fn get_data(this: *mut c_void, pformatetc: *const FORMATETC, pmedium: *mut STGMEDIUM) -> HRESULT {
    if pformatetc.is_null() || pmedium.is_null() {
        return E_INVALIDARG;
    }
    // SAFETY: `this` es un `DataObject` vivo; `pformatetc` no es nulo.
    let (me, f) = unsafe { (this_ref::<DataObject>(this), &*pformatetc) };
    let medium = match me.offer(f) {
        Ok(Offer::Descriptor) => match descriptor::group(&me.set.entries) {
            Ok(h) => STGMEDIUM { tymed: TYMED_HGLOBAL.0 as u32, u: STGMEDIUM_0 { hGlobal: h }, pUnkForRelease: ManuallyDrop::new(None) },
            Err(e) => return e.code(),
        },
        Ok(Offer::Contents(Some(i))) => {
            let Some(reader) = me.set.reader(i) else { return DV_E_LINDEX };
            let e = &me.set.entries[i];
            let name = e.rel.rsplit('\\').next().unwrap_or(&e.rel).to_string();
            let pstm = stream::new(reader, name, e.modified);
            STGMEDIUM { tymed: TYMED_ISTREAM.0 as u32, u: STGMEDIUM_0 { pstm: ManuallyDrop::new(Some(pstm)) }, pUnkForRelease: ManuallyDrop::new(None) }
        }
        Ok(Offer::Contents(None)) => return DV_E_LINDEX,
        Err(hr) => return hr,
    };
    // SAFETY: `pmedium` no es nulo; quien llama es dueño de lo que se le entrega.
    unsafe { pmedium.write(medium) };
    S_OK
}

unsafe extern "system" fn get_data_here(_this: *mut c_void, _f: *const FORMATETC, _m: *mut STGMEDIUM) -> HRESULT {
    E_NOTIMPL
}

unsafe extern "system" fn query_get_data(this: *mut c_void, pformatetc: *const FORMATETC) -> HRESULT {
    if pformatetc.is_null() {
        return E_INVALIDARG;
    }
    // SAFETY: `this` es un `DataObject` vivo; `pformatetc` no es nulo.
    let (me, f) = unsafe { (this_ref::<DataObject>(this), &*pformatetc) };
    match me.offer(f) {
        Ok(_) => S_OK,
        Err(hr) => hr,
    }
}

unsafe extern "system" fn canonical(_this: *mut c_void, _in: *const FORMATETC, out: *mut FORMATETC) -> HRESULT {
    if !out.is_null() {
        // SAFETY: puntero de salida no nulo que da quien llama.
        unsafe { (*out).ptd = std::ptr::null_mut() };
    }
    E_NOTIMPL
}

unsafe extern "system" fn set_data(_this: *mut c_void, _f: *const FORMATETC, _m: *const STGMEDIUM, _release: BOOL) -> HRESULT {
    E_NOTIMPL
}

unsafe extern "system" fn enum_format_etc(this: *mut c_void, direction: u32, out: *mut *mut c_void) -> HRESULT {
    if out.is_null() {
        return E_INVALIDARG;
    }
    // SAFETY: `out` no es nulo.
    unsafe { *out = std::ptr::null_mut() };
    if direction != DATADIR_GET.0 as u32 {
        return E_NOTIMPL;
    }
    // SAFETY: `this` es un `DataObject` vivo; el enumerador copia los formatos.
    unsafe {
        match SHCreateStdEnumFmtEtc(&this_ref::<DataObject>(this).formats()) {
            Ok(e) => {
                *out = e.into_raw();
                S_OK
            }
            Err(e) => e.code(),
        }
    }
}

unsafe extern "system" fn d_advise(_this: *mut c_void, _f: *const FORMATETC, _advf: u32, _sink: *mut c_void, _conn: *mut u32) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED
}

unsafe extern "system" fn d_unadvise(_this: *mut c_void, _conn: u32) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED
}

unsafe extern "system" fn enum_d_advise(_this: *mut c_void, _out: *mut *mut c_void) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED
}
