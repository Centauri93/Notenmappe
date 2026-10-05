/**
 * Service Worker: hält die App vollständig offline verfügbar.
 * Strategie: App-Shell beim Installieren cachen, danach „cache first“ mit
 * Aktualisierung im Hintergrund. Nutzerdaten liegen ausschließlich in
 * IndexedDB und werden hier bewusst nicht angefasst.
 */

// Version bei jeder Code-Änderung erhöhen – dadurch lädt die App frisch.
const CACHE = 'notenmappe2-v24';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/security.js',
  './js/ui.js',
  './js/dnd.js',
  './js/zip.js',
  './js/photo.js',
  './js/names.js',
  './js/seatlayout.js',
  './js/backup.js',
  './js/views/classnav.js',
  './js/views/classes.js',
  './js/views/students.js',
  './js/views/seating.js',
  './js/views/table.js',
  './js/views/reportparts.js',
  './js/views/printpreview.js',
  './js/views/report.js',
  './js/views/blanklist.js',
  './js/views/gradedialog.js',
  './js/views/conferences.js',
  './js/views/conferencestudent.js',
  './js/views/classbook.js',
  './js/views/settings.js',
  './js/views/lock.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));

      return cached || network;
    }),
  );
});
