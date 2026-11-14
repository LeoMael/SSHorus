//! Pellizco del touchpad: que nunca agrande la app entera.
//!
//! Linux: WebKitGTK atiende el pellizco fuera de la página (un `GtkGestureZoom` propio del WebView
//! que cambia la escala de toda la página), así que `preventDefault` en JS no lo para. Aquí cada
//! ventana tiene su propio `GtkGestureZoom` en fase de CAPTURA: GTK lo consulta antes que al WebView,
//! al reclamar la secuencia el evento ya no sigue, y el gesto se reenvía a la interfaz como el evento
//! `pinch-zoom` (`{ phase, scale }`), que el mapa de infraestructura usa para su propio zoom.
//!
//! Windows (WebView2) y macOS (WKWebView) no lo necesitan: con `zoomHotkeysEnabled` en `false` (el
//! valor por defecto de Tauri) wry desactiva `IsPinchZoomEnabled` y la página recibe el pellizco como
//! rueda con Ctrl; WKWebView no amplía (`allowsMagnification` es `false`) y envía `gesture*` a la página.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

/// Evento hacia la interfaz con cada paso del pellizco.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const EV_PINCH_ZOOM: &str = "pinch-zoom";

/// `scale`: escala acumulada desde el comienzo del gesto (1 al empezar).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, Copy, serde::Serialize)]
struct PinchPayload {
    phase: &'static str,
    scale: f64,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pinch-zoom")
        .on_window_ready(|window| {
            #[cfg(target_os = "linux")]
            linux::install(window);
            #[cfg(not(target_os = "linux"))]
            let _ = window;
        })
        .build()
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{PinchPayload, EV_PINCH_ZOOM};
    use gtk::prelude::*;
    use tauri::{Emitter, Runtime, Window};

    pub fn install<R: Runtime>(window: tauri::Window<R>) {
        let w = window.clone();
        let res = window.run_on_main_thread(move || {
            if let Err(e) = attach(&w) {
                log::warn!("No se pudo capturar el pellizco del touchpad: {e}");
            }
        });
        if let Err(e) = res {
            log::warn!("No se pudo capturar el pellizco del touchpad: {e}");
        }
    }

    fn attach<R: Runtime>(window: &Window<R>) -> tauri::Result<()> {
        let toplevel = window.gtk_window()?;
        let gesture = gtk::GestureZoom::new(&toplevel);
        gesture.set_propagation_phase(gtk::PropagationPhase::Capture);

        let send = {
            let window = window.clone();
            move |phase: &'static str, scale: f64| {
                let _ = window.emit_to(window.label(), EV_PINCH_ZOOM, PinchPayload { phase, scale });
            }
        };
        let on_begin = send.clone();
        gesture.connect_begin(move |g, _| {
            // Reclamada, GTK no pasa la secuencia al WebView (ni a su zoom de página).
            g.set_state(gtk::EventSequenceState::Claimed);
            on_begin("begin", 1.0);
        });
        let on_update = send.clone();
        gesture.connect_scale_changed(move |_, scale| on_update("update", scale));
        gesture.connect_end(move |_, _| send("end", 1.0));

        // En GTK3 el widget no mantiene vivos sus gestos: este cierre lo guarda hasta que se destruye la ventana.
        toplevel.connect_destroy(move |_| {
            let _ = &gesture;
        });
        Ok(())
    }
}
