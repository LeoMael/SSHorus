// Configuraciones reales de prueba para el registro de visitas (Caddy y nginx) y salidas de error tal
// como las dan las herramientas (Caddy 2.6 de EPEL, Caddy 2.11, nginx 1.20 de Rocky 9, SELinux).
// Solo para las pruebas (webLogPatch.test.ts y webLogSetup.test.ts).

/** Caddyfile principal con opciones globales (y su `log` de ejecución), snippet e `import`. */
export const CADDYFILE = `{
	email admin@example.com
	log {
		level INFO
	}
}

(common) {
	encode zstd gzip
	header -Server
}

example.com, www.example.com {
	import common
	reverse_proxy 127.0.0.1:3000
}

import sites/*.caddy
`;

/** Archivo importado: un sitio con `log` sin archivo (va al diario) y otro que ya escribe en archivo. */
export const CADDY_SITES = `api.example.com {
	log {
		format console
	}
	@static path *.css *.js
	handle @static {
		file_server
	}
	reverse_proxy 127.0.0.1:4000
}

https://shop.example.com:8443 {
	log {
		output file /var/log/caddy/shop.log
	}
	respond "tienda"
}

b.example.com {
	log
	respond "b"
}
`;

/** nginx.conf como el de Rocky 9: log_format y access_log en http, un server dentro y los include. */
export const NGINX_CONF = `user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';
    access_log  /var/log/nginx/access.log  main;
    include /etc/nginx/conf.d/*.conf;
    server {
        listen       80;
        server_name  _;
        root         /usr/share/nginx/html;
    }
}
`;
/** Línea del `server {` de NGINX_CONF (justo después de un include dentro de http). */
export const NGINX_CONF_SERVER_LINE = 16;

/** conf.d con varios server: uno con `access_log off;` solo en un location y otro en el server. */
export const NGINX_SITES = `server {
    listen 80;
    server_name app.example.com;
    root /srv/app;
    location ~* \\.(css|js)$ {
        access_log off;
        expires 7d;
    }
}

server { listen 80;
    server_name api.example.com;
    access_log off;
    location / {
        proxy_pass http://127.0.0.1:4000;
    }
}

server { listen 81; server_name corto.example.com; return 200; }
`;

/** Error de `caddy validate` en Caddy 2.6 (EPEL). */
export const CADDY26_VALIDATE_ERROR = `2026/11/25 22:10:15.566 INFO	using provided configuration	{"config_file": "/etc/caddy/Caddyfile", "config_adapter": ""}
Error: adapting config using caddyfile: /etc/caddy/sites/api.caddy:3: unrecognized directive: bogus_directive`;

/** Caddy 2.11 corriendo como «caddy» no puede abrir un registro que `caddy validate` creó como root. */
export const CADDY_RELOAD_DENIED = `{"level":"error","ts":1795644550.519285,"msg":"sending configuration to instance: caddy responded with error: HTTP 400: {\\"error\\":\\"loading config: loading new config: setting up custom log 'log0': opening log writer using &logging.FileWriter{Filename:\\\\\\"/var/log/caddy/example.com.log\\\\\\"}: open /var/log/caddy/example.com.log: permission denied\\"}"}`;

/** nginx -t falla por una directiva mal escrita en un include. */
export const NGINX_EMERG = `nginx: [emerg] unknown directive "acess_log" in /etc/nginx/conf.d/sites.conf:13
nginx: configuration file /etc/nginx/nginx.conf test failed`;

/** Recarga de nginx con SELinux en Rocky: el log fuera de /var/log/nginx no tiene httpd_log_t. */
export const NGINX_SELINUX_DENIED = `nginx: [emerg] open() "/srv/logs/app.access.log" failed (13: Permission denied)`;
export const AVC_DENIED = `type=AVC msg=audit(1795644720.818:412): avc:  denied  { append } for  pid=1234 comm="nginx" name="app.access.log" dev="vda1" ino=393 scontext=system_u:system_r:httpd_t:s0 tcontext=unconfined_u:object_r:var_t:s0 tclass=file permissive=0`;
