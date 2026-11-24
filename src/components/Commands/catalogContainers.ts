// Secciones de Podman del catálogo (la categoría Docker se genera a partir de estas filas).
import type { McpTask } from "../../api/mcp";
import type { Distro } from "./catalog";

export type CatalogRow = [name: string, command: string, description?: string, flags?: string, distro?: Distro, id?: string];

export interface CatalogSection {
  category: string;
  group: string;
  rows: CatalogRow[];
  perm?: McpTask;
}

export const PODMAN_SECTIONS: CatalogSection[] = [
  {
    category: "Podman",
    group: "Ver y estado",
    rows: [
      ["Contenedores en ejecución", "podman ps", "Lista los contenedores que están en marcha.", "r"],
      [
        "Todos los contenedores",
        'podman ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}"',
        "Todos los contenedores (también detenidos) con estado, imagen y puertos.",
        "r",
      ],
      ["Uso de recursos en vivo", "podman stats", "CPU, memoria y red de cada contenedor, actualizado en vivo.", "i"],
      ["Uso de recursos (una vez)", "podman stats --no-stream", "Foto única del consumo de cada contenedor.", "r"],
      ["Detalles de un contenedor", "podman inspect {{contenedor}}", "Configuración completa del contenedor en JSON.", "r"],
      ["Procesos dentro del contenedor", "podman top {{contenedor}}", "Procesos que corren dentro del contenedor.", "r"],
      ["Puertos publicados", "podman port {{contenedor}}", "Qué puertos del servidor apuntan al contenedor.", "r"],
      ["Información de Podman", "podman info", "Versión, almacenamiento, red y configuración del motor.", "r"],
      ["Versión", "podman version", "Versión del cliente y del motor.", "r"],
      ["Espacio usado", "podman system df", "Espacio en disco de imágenes, contenedores y volúmenes.", "r"],
    ],
  },
  {
    category: "Podman",
    group: "Levantar, parar, reiniciar",
    rows: [
      ["Iniciar contenedor", "podman start {{contenedor}}", "Arranca un contenedor detenido."],
      ["Detener contenedor", "podman stop {{contenedor}}", "Detiene el contenedor de forma ordenada."],
      ["Reiniciar contenedor", "podman restart {{contenedor}}", "Detiene y vuelve a arrancar el contenedor."],
      ["Pausar contenedor", "podman pause {{contenedor}}", "Congela los procesos del contenedor."],
      ["Reanudar contenedor", "podman unpause {{contenedor}}", "Continúa un contenedor pausado."],
      [
        "Crear y levantar (en segundo plano)",
        "podman run -d --name {{nombre}} -p {{puerto_host}}:{{puerto_contenedor}} {{imagen}}",
        "Crea un contenedor nuevo publicando un puerto y lo deja corriendo.",
      ],
      [
        "Levantar con reinicio automático",
        "podman run -d --restart=always --name {{nombre}} {{imagen}}",
        "Crea un contenedor que se reinicia solo si se cae.",
      ],
      [
        "Levantar con carpeta compartida",
        "podman run -d --name {{nombre}} -v {{carpeta_host}}:{{carpeta_contenedor}}:Z {{imagen}}",
        "Crea un contenedor montando una carpeta del servidor (con etiqueta SELinux).",
      ],
      ["Iniciar todos los detenidos", "podman start --all", "Arranca todos los contenedores detenidos."],
      ["Detener todos", "podman stop --all", "Detiene TODOS los contenedores en marcha.", "d"],
    ],
  },
  {
    category: "Podman",
    group: "Logs y entrar al contenedor",
    rows: [
      ["Ver logs", "podman logs --tail {{lineas:200}} {{contenedor}}", "Últimas líneas del log del contenedor.", "r"],
      ["Seguir logs en vivo", "podman logs -f --tail {{lineas:100}} {{contenedor}}", "Muestra los logs del contenedor en tiempo real.", "i"],
      ["Logs desde hace un tiempo", "podman logs --since {{desde:1h}} {{contenedor}}", "Logs generados en el periodo indicado (10m, 1h, 24h…).", "r"],
      ["Entrar con shell", "podman exec -it {{contenedor}} {{shell:sh}}", "Abre una shell dentro del contenedor.", "i"],
      ["Ejecutar un comando dentro", "podman exec {{contenedor}} {{comando}}", "Ejecuta un comando dentro del contenedor.", "r"],
      ["Copiar archivo al contenedor", "podman cp {{archivo}} {{contenedor}}:{{ruta}}", "Copia un archivo del servidor al contenedor."],
      ["Copiar archivo desde el contenedor", "podman cp {{contenedor}}:{{ruta}} {{destino}}", "Copia un archivo del contenedor al servidor."],
    ],
  },
  {
    category: "Podman",
    group: "Imágenes",
    rows: [
      ["Listar imágenes", "podman images", "Imágenes descargadas o construidas en el servidor.", "r"],
      ["Descargar imagen", "podman pull {{imagen}}", "Descarga una imagen del registro."],
      [
        "Construir imagen",
        "podman build -t {{nombre}}:{{etiqueta:latest}} {{carpeta:.}}",
        "Construye una imagen a partir del Containerfile/Dockerfile de la carpeta.",
      ],
      ["Etiquetar imagen", "podman tag {{imagen}} {{nueva_etiqueta}}", "Añade otro nombre/etiqueta a una imagen."],
      ["Subir imagen a registro", "podman push {{imagen}}", "Publica la imagen en su registro."],
      ["Iniciar sesión en registro", "podman login {{registro}}", "Pide usuario y contraseña del registro.", "i"],
      ["Historial de una imagen", "podman history {{imagen}}", "Capas que forman la imagen y su tamaño.", "r"],
    ],
  },
  {
    category: "Podman",
    group: "Compose (varios contenedores)",
    rows: [
      ["Levantar proyecto", "podman compose up -d", "Levanta los servicios del compose de la carpeta actual."],
      ["Bajar proyecto", "podman compose down", "Detiene y elimina los contenedores del proyecto."],
      ["Estado del proyecto", "podman compose ps", "Estado de los servicios del proyecto.", "r"],
      ["Logs del proyecto", "podman compose logs -f --tail {{lineas:100}}", "Logs de todos los servicios en vivo.", "i"],
      ["Reconstruir y levantar", "podman compose up -d --build", "Reconstruye las imágenes y levanta el proyecto."],
      ["Actualizar imágenes y levantar", "podman compose pull && podman compose up -d", "Descarga las imágenes nuevas y recrea los servicios."],
    ],
  },
  {
    category: "Podman",
    group: "Pods, volúmenes y redes",
    rows: [
      ["Listar pods", "podman pod ps", "Pods y cuántos contenedores tiene cada uno.", "r"],
      ["Crear pod", "podman pod create --name {{pod}} -p {{puerto_host}}:{{puerto}}", "Crea un pod publicando un puerto."],
      ["Iniciar pod", "podman pod start {{pod}}", "Arranca todos los contenedores del pod."],
      ["Detener pod", "podman pod stop {{pod}}", "Detiene todos los contenedores del pod."],
      ["Listar volúmenes", "podman volume ls", "Volúmenes de datos.", "r"],
      ["Crear volumen", "podman volume create {{volumen}}", "Crea un volumen de datos."],
      ["Detalles de volumen", "podman volume inspect {{volumen}}", "Dónde está y cómo está configurado el volumen.", "r"],
      ["Listar redes", "podman network ls", "Redes de contenedores.", "r"],
      ["Crear red", "podman network create {{red}}", "Crea una red para conectar contenedores."],
    ],
  },
  {
    category: "Podman",
    group: "Arranque automático con systemd",
    rows: [
      [
        "Generar servicio (Quadlet)",
        "mkdir -p ~/.config/containers/systemd && cat > ~/.config/containers/systemd/{{nombre}}.container <<'EOF'\n" +
          "[Unit]\nDescription={{nombre}}\n\n[Container]\nImage={{imagen}}\nContainerName={{nombre}}\n" +
          "PublishPort={{puerto_host}}:{{puerto_contenedor}}\n\n[Service]\nRestart=always\n\n" +
          "[Install]\nWantedBy=default.target\nEOF",
        "Crea el archivo .container para que systemd gestione el contenedor. Después: recargar servicios y activarlo.",
      ],
      ["Recargar servicios de usuario", "systemctl --user daemon-reload", "Relee los servicios (necesario tras crear un Quadlet)."],
      ["Activar servicio del contenedor", "systemctl --user enable --now {{nombre}}", "Arranca el servicio ahora y en cada inicio."],
      ["Mantener servicios sin sesión iniciada", "sudo loginctl enable-linger $USER", "Permite que tus servicios sigan corriendo sin tener sesión abierta.", "s"],
      ["Actualizar contenedores automáticamente", "podman auto-update", "Actualiza los contenedores marcados con auto-update."],
    ],
  },
  {
    category: "Podman",
    group: "Limpieza",
    rows: [
      ["Borrar contenedor", "podman rm {{contenedor}}", "Elimina un contenedor detenido.", "d"],
      ["Borrar contenedor (forzado)", "podman rm -f {{contenedor}}", "Elimina el contenedor aunque esté en marcha.", "d"],
      ["Borrar imagen", "podman rmi {{imagen}}", "Elimina una imagen.", "d"],
      ["Borrar contenedores detenidos", "podman container prune -f", "Elimina todos los contenedores detenidos.", "d"],
      ["Borrar imágenes sin usar", "podman image prune -a -f", "Elimina todas las imágenes que no usa ningún contenedor.", "d"],
      ["Limpieza total", "podman system prune -a -f", "Elimina contenedores detenidos, imágenes sin usar, redes y caché de construcción.", "d"],
    ],
  },
];
