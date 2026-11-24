// Secciones de sistema, red, servicios, usuarios, paquetes, seguridad, web y git del catálogo.
import { KEY_USER_CATALOG_COMMAND } from "../admin/keyUser";
import { USER_DELETE_ROWS, USER_EDIT_ROWS, type GeneratedRow } from "../admin/catalogUsers";
import { WEB_SITE_ROWS } from "../admin/webSites";
import type { CatalogRow, CatalogSection } from "./catalogContainers";

function rowsOf(list: GeneratedRow[]): CatalogRow[] {
  return list.map((r): CatalogRow => [r.name, r.command, r.description, r.flags, undefined, r.id]);
}

export const SYSTEM_SECTIONS: CatalogSection[] = [
  {
    category: "Análisis del sistema",
    group: "Sistema",
    rows: [
      ["Sistema operativo", "cat /etc/os-release", "Distribución y versión.", "r"],
      ["Kernel y arquitectura", "uname -a", "Versión del kernel y arquitectura.", "r"],
      ["Nombre del equipo", "hostnamectl", "Nombre, sistema, kernel y tipo de máquina.", "r"],
      ["Tiempo encendido y carga", "uptime", "Desde cuándo está encendido y la carga media.", "r"],
      ["CPU (detalle)", "lscpu", "Modelo, núcleos e hilos del procesador.", "r"],
      ["Número de CPUs", "nproc", "Cantidad de procesadores disponibles.", "r"],
      ["Memoria y swap", "free -h", "Memoria usada y libre.", "r"],
    ],
  },
  {
    category: "Análisis del sistema",
    group: "Discos",
    rows: [
      ["Discos (uso)", "df -hT -x tmpfs -x devtmpfs", "Espacio usado por cada disco montado.", "r"],
      ["Discos (dispositivos)", "lsblk", "Discos y particiones.", "r"],
      ["Carpetas más pesadas", "du -h --max-depth=1 {{carpeta:/}} 2>/dev/null | sort -hr | head -20", "Las 20 subcarpetas que más ocupan.", "r"],
    ],
  },
  {
    category: "Análisis del sistema",
    group: "Actividad",
    rows: [
      ["Procesos que más CPU usan", "ps aux --sort=-%cpu | head -15", "Top 15 por uso de CPU.", "r"],
      ["Procesos que más memoria usan", "ps aux --sort=-%mem | head -15", "Top 15 por uso de memoria.", "r"],
      ["Servicios fallidos", "systemctl --failed", "Servicios systemd en estado fallido.", "r"],
      ["Puertos abiertos", "ss -tulpn", "Puertos TCP/UDP a la escucha y qué proceso los usa.", "r"],
      ["Últimos errores del sistema", "journalctl -p err -n 50 --no-pager", "Las 50 últimas entradas de error del journal.", "r"],
      ["Últimos inicios de sesión", "last -n 20", "Quién entró y cuándo.", "r"],
      ["Usuarios conectados", "who", "Sesiones abiertas ahora.", "r"],
      ["Contenedores (Podman)", "podman ps -a", "Todos los contenedores de Podman.", "r"],
      ["Contenedores (Docker)", "docker ps -a", "Todos los contenedores de Docker.", "r"],
    ],
  },
  {
    category: "Análisis del sistema",
    group: "Actualizaciones",
    rows: [
      ["Actualizaciones pendientes", "dnf check-update", "Paquetes con actualización disponible.", "r", "rpm"],
      ["Actualizaciones pendientes", "apt list --upgradable", "Paquetes con actualización disponible.", "r", "deb"],
      ["Actualizaciones pendientes", "apk version -l '<'", "Paquetes con actualización disponible.", "r", "apk"],
    ],
  },
  {
    category: "Procesos",
    group: "Procesos",
    rows: [
      ["Monitor interactivo", "command -v htop >/dev/null && htop || top", "Monitor de procesos en vivo (htop si está, si no top).", "i"],
      ["Buscar proceso", "ps aux | grep -i {{nombre}}", "Procesos cuyo nombre o argumentos coinciden.", "r"],
      ["Terminar proceso", "kill {{pid}}", "Pide al proceso que termine (SIGTERM).", "d"],
      ["Forzar cierre", "kill -9 {{pid}}", "Mata el proceso inmediatamente (SIGKILL).", "d"],
      ["Árbol de procesos", "pstree -p", "Procesos en forma de árbol con su PID.", "r"],
    ],
  },
  {
    category: "Discos y archivos",
    group: "Espacio",
    rows: [
      ["Espacio libre", "df -h", "Espacio de cada sistema de archivos.", "r"],
      ["Tamaño de carpeta", "du -sh {{carpeta}}", "Cuánto ocupa una carpeta.", "r"],
      ["Archivos más grandes", "find {{carpeta:/}} -type f -size +{{tamaño:100M}} -exec ls -lh {} \\; 2>/dev/null", "Archivos que superan el tamaño indicado.", "r"],
    ],
  },
  {
    category: "Discos y archivos",
    group: "Buscar",
    rows: [
      ["Buscar archivo por nombre", 'find {{carpeta:.}} -iname "*{{nombre}}*"', "Busca archivos cuyo nombre contenga el texto.", "r"],
      ["Buscar texto en archivos", 'grep -rn "{{texto}}" {{carpeta:.}}', "Busca un texto dentro de los archivos.", "r"],
    ],
  },
  {
    category: "Discos y archivos",
    group: "Comprimir",
    rows: [
      ["Comprimir carpeta", "tar -czf {{archivo}}.tar.gz {{carpeta}}", "Crea un .tar.gz con la carpeta."],
      ["Descomprimir", "tar -xzf {{archivo}}", "Extrae un .tar.gz en la carpeta actual."],
    ],
  },
  {
    category: "Red",
    group: "Direcciones y conexiones",
    rows: [
      ["IPs del servidor", "ip -br addr", "Interfaces de red y sus direcciones.", "r"],
      ["IP pública", "curl -s ifconfig.me", "Dirección IP con la que sale a Internet.", "r"],
      ["Probar conexión", "ping -c 4 {{host}}", "Envía 4 pings al host.", "r"],
      ["Ruta hacia un host", "tracepath {{host}}", "Saltos de red hasta el host.", "r"],
      ["Puertos en uso", "ss -tulpn", "Puertos a la escucha.", "r"],
      ["¿Quién usa un puerto?", "ss -tulpn | grep :{{puerto}}", "Qué proceso escucha en ese puerto.", "r"],
      ["Probar una web", "curl -I {{url}}", "Cabeceras de respuesta de una URL.", "r"],
      ["DNS", "dig {{dominio}}", "Consulta DNS del dominio.", "r"],
    ],
  },
  {
    category: "Red",
    group: "Firewall",
    perm: "firewall",
    rows: [
      ["Firewall", "sudo firewall-cmd --list-all", "Reglas activas de firewalld.", "rs", "rpm"],
      ["Abrir puerto", "sudo firewall-cmd --add-port={{puerto}}/tcp --permanent && sudo firewall-cmd --reload", "Abre un puerto TCP de forma permanente.", "s", "rpm"],
      ["Firewall", "sudo ufw status verbose", "Reglas activas de ufw.", "rs", "deb"],
      ["Abrir puerto", "sudo ufw allow {{puerto}}/tcp", "Abre un puerto TCP en ufw.", "s", "deb"],
    ],
  },
  {
    category: "Servicios",
    group: "systemd",
    rows: [
      ["Estado de un servicio", "systemctl status {{servicio}} --no-pager", "Si está activo, desde cuándo y sus últimos logs.", "r"],
      ["Iniciar / detener / reiniciar", "sudo systemctl {{accion:restart}} {{servicio}}", "Cambia el estado del servicio.", "s"],
      ["Activar al arrancar", "sudo systemctl enable --now {{servicio}}", "Arranca el servicio ahora y en cada inicio.", "s"],
      ["Servicios activos", "systemctl list-units --type=service --state=running --no-pager", "Servicios en marcha.", "r"],
      ["Logs de un servicio", "journalctl -u {{servicio}} -n {{lineas:100}} --no-pager", "Últimas líneas del log del servicio.", "r"],
      ["Logs en vivo", "journalctl -u {{servicio}} -f", "Log del servicio en tiempo real.", "i"],
    ],
  },
  {
    category: "Logs",
    group: "Logs",
    rows: [
      ["Logs del sistema (hoy)", "journalctl --since today --no-pager | tail -200", "Últimas 200 líneas del journal de hoy.", "r"],
      ["Errores recientes", "journalctl -p err -b --no-pager", "Errores desde el último arranque.", "r"],
      ["Seguir un archivo de log", "tail -f {{archivo}}", "Muestra las líneas nuevas del archivo en vivo.", "i"],
      ["Logs de nginx (errores)", "sudo tail -n 100 /var/log/nginx/error.log", "Últimos errores de nginx.", "rs"],
    ],
  },
  {
    category: "Usuarios",
    group: "Ver",
    rows: [["Quién soy", "whoami && id", "Tu usuario, grupos e identificadores.", "r"]],
  },
  {
    category: "Usuarios",
    group: "Crear",
    perm: "users-create",
    rows: [
      ["Crear usuario", "sudo useradd -m {{usuario}}", "Crea un usuario con carpeta personal.", "s"],
      [
        "Crear usuario con acceso solo por clave SSH",
        KEY_USER_CATALOG_COMMAND,
        "Usuario sin contraseña que solo entra con su llave pública (se escribe en ~/.ssh/authorized_keys, 700/600). " +
          "Opcional: grupo extra (p. ej. el de AllowGroups de sshd, varios separados por comas), admin=si (wheel o sudo) y linger=si. " +
          "No cambia sshd_config ni PasswordAuthentication.",
        "s",
        undefined,
        "crear-usuario-clave",
      ],
    ],
  },
  {
    category: "Usuarios",
    group: "Editar",
    perm: "users-edit",
    rows: [
      ["Cambiar contraseña", "sudo passwd {{usuario}}", "Pide la contraseña nueva del usuario.", "si"],
      ["Dar sudo", "sudo usermod -aG wheel {{usuario}}", "Añade el usuario al grupo wheel.", "sd", "rpm"],
      ["Dar sudo", "sudo usermod -aG sudo {{usuario}}", "Añade el usuario al grupo sudo.", "sd", "deb"],
      ["Dar sudo", "sudo addgroup {{usuario}} wheel", "Añade el usuario al grupo wheel.", "sd", "apk"],
      ...rowsOf(USER_EDIT_ROWS),
    ],
  },
  {
    category: "Usuarios",
    group: "Borrar",
    perm: "users-delete",
    rows: rowsOf(USER_DELETE_ROWS),
  },
  {
    category: "Usuarios",
    group: "Permisos de archivos",
    rows: [["Cambiar dueño", "sudo chown -R {{usuario}}:{{grupo}} {{ruta}}", "Cambia el dueño de una ruta y todo su contenido.", "sd"]],
  },
  {
    category: "Paquetes",
    group: "Fedora/RHEL (dnf)",
    rows: [
      ["Actualizar todo", "sudo dnf upgrade -y", "Instala todas las actualizaciones.", "s", "rpm"],
      ["Instalar", "sudo dnf install -y {{paquete}}", "Instala un paquete.", "s", "rpm"],
      ["Buscar", "dnf search {{paquete}}", "Busca paquetes por nombre o descripción.", "r", "rpm"],
      ["Desinstalar", "sudo dnf remove {{paquete}}", "Desinstala un paquete.", "sd", "rpm"],
    ],
  },
  {
    category: "Paquetes",
    group: "Debian/Ubuntu (apt)",
    rows: [
      ["Actualizar todo", "sudo apt update && sudo apt upgrade -y", "Actualiza la lista e instala las actualizaciones.", "s", "deb"],
      ["Instalar", "sudo apt install -y {{paquete}}", "Instala un paquete.", "s", "deb"],
      ["Buscar", "apt search {{paquete}}", "Busca paquetes por nombre o descripción.", "r", "deb"],
      ["Desinstalar", "sudo apt remove {{paquete}}", "Desinstala un paquete.", "sd", "deb"],
    ],
  },
  {
    category: "Paquetes",
    group: "Alpine (apk)",
    rows: [
      ["Actualizar todo", "sudo apk update && sudo apk upgrade", "Actualiza el índice e instala las actualizaciones.", "s", "apk"],
      ["Instalar", "sudo apk add {{paquete}}", "Instala un paquete.", "s", "apk"],
      ["Buscar", "apk search {{paquete}}", "Busca paquetes por nombre.", "r", "apk"],
      ["Desinstalar", "sudo apk del {{paquete}}", "Desinstala un paquete.", "sd", "apk"],
    ],
  },
  {
    category: "Seguridad",
    group: "Accesos",
    rows: [
      ["Intentos de acceso fallidos", 'sudo journalctl -u sshd | grep -i "failed" | tail -50', "Últimos intentos de entrar por SSH que fallaron.", "rs"],
      ["Llaves SSH autorizadas", "cat ~/.ssh/authorized_keys", "Llaves públicas que pueden entrar con tu usuario.", "r"],
      ["Estado de SELinux", "getenforce", "Enforcing, Permissive o Disabled.", "r"],
      ["Fail2ban", "sudo fail2ban-client status sshd", "IPs bloqueadas por fail2ban en SSH.", "rs"],
    ],
  },
  {
    category: "Web",
    group: "nginx y certificados",
    rows: [
      ["Probar configuración nginx", "sudo nginx -t", "Comprueba la configuración antes de recargar.", "rs"],
      ["Recargar nginx", "sudo systemctl reload nginx", "Aplica la configuración sin cortar conexiones.", "s"],
      ["Certificados (certbot)", "sudo certbot certificates", "Certificados y fechas de caducidad.", "rs"],
      ["Renovar certificados", "sudo certbot renew", "Renueva los certificados que estén por caducar.", "s"],
    ],
  },
  {
    category: "Web",
    group: "Sitios (dominio → puerto)",
    rows: rowsOf(WEB_SITE_ROWS),
  },
  {
    category: "Git",
    group: "Repositorio",
    rows: [
      ["Estado", "git status", "Cambios pendientes en la carpeta actual.", "r"],
      ["Traer cambios", "git pull", "Descarga e integra los cambios del remoto."],
      ["Últimos commits", "git log --oneline -n {{n:15}}", "Historial resumido.", "r"],
      ["Cambiar de rama", "git checkout {{rama}}", "Cambia a otra rama."],
    ],
  },
];
