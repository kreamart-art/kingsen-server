/* Example community sets (same ones the app's offline mock shows).
   Imported by both server.js (auto-seed on first boot) and seed.js (manual). */
export const SEED = [
  { id: "seed-1", name: "Festivalmodus", author: "DJ Sven", lang: "nl", uses: 128, likes: 42, created_at: "2026-05-20",
    code: "KGS1.JTdCJTIybiUyMiUzQSUyMkZlc3RpdmFsbW9kdXMlMjIlMkMlMjJsJTIyJTNBJTIybmwlMjIlMkMlMjJkJTIyJTNBJTdCJTIyMiUyMiUzQSU3QiUyMnQlMjIlM0ElMjJVaXRkZWxlbiUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjBkZWVsdCUyMDMlMjBzbG9ra2VuJTIwdWl0JTIwYWFuJTIwZGUlMjBkYW5zdmxvZXIuJTIyJTdEJTJDJTIyNCUyMiUzQSU3QiUyMnQlMjIlM0ElMjJTaWxlbnQlMjBkaXNjbyUyMiUyQyUyMnglMjIlM0ElMjJJZWRlcmVlbiUyMGRvZXQlMjAxMCUyMHNlYyUyMGVlbiUyMGRhbnNtb3ZlLiUyMFdpZSUyMHN0b3B0JTJDJTIwZHJpbmt0LiUyMiU3RCUyQyUyMjglMjIlM0ElN0IlMjJ0JTIyJTNBJTIyRmVzdGl2YWxyZWdlbCUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjB2ZXJ6aW50JTIwZWVuJTIwcmVnZWwlMjBkaWUlMjBkZSUyMGhlbGUlMjBzZXQlMjBnZWxkdC4lMjIlN0QlMkMlMjIxMCUyMiUzQSU3QiUyMnQlMjIlM0ElMjJEcm9wJTIyJTJDJTIyeCUyMiUzQSUyMkJpaiUyMGRlJTIwdm9sZ2VuZGUlMjAnZHJvcCclMjBuZWVtdCUyMGllZGVyZWVuJTIwZWVuJTIwc2xvay4lMjIlN0QlN0QlN0Q=" },
  { id: "seed-2", name: "Eerste date", author: "Lotte", lang: "nl", uses: 86, likes: 29, created_at: "2026-05-22",
    code: "KGS1.JTdCJTIybiUyMiUzQSUyMkVlcnN0ZSUyMGRhdGUlMjIlMkMlMjJsJTIyJTNBJTIybmwlMjIlMkMlMjJkJTIyJTNBJTdCJTIyMyUyMiUzQSU3QiUyMnQlMjIlM0ElMjJEZWVsJTIwaWV0cyUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjB2ZXJ0ZWx0JTIwaWV0cyUyMHBlcnNvb25saWprcyUyMCVFMiU4MCU5NCUyMG9mJTIwbmVlbXQlMjBlZW4lMjBzbG9rLiUyMiU3RCUyQyUyMjQlMjIlM0ElN0IlMjJ0JTIyJTNBJTIyUm9kZSUyMHZsYWdnZW4lMjIlMkMlMjJ4JTIyJTNBJTIyTm9lbSUyMG9tJTIwZGUlMjBiZXVydCUyMGVlbiUyMHJlZCUyMGZsYWcuJTIwV2llJTIwZmFhbHQlMkMlMjBkcmlua3QuJTIyJTdEJTJDJTIyOSUyMiUzQSU3QiUyMnQlMjIlM0ElMjJCZWtlbm5lbiUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjBiZWtlbnQlMjBpZXRzJTIwJUUyJTgwJTk0JTIwb2YlMjBuZWVtdCUyMDIlMjBzbG9ra2VuLiUyMiU3RCUyQyUyMlElMjIlM0ElN0IlMjJ0JTIyJTNBJTIyRGllcGUlMjB2cmFhZyUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjBzdGVsdCUyMGVlbiUyMGRpZXBlJTIwdnJhYWcuJTIwRWVybGlqayUyMGFudHdvb3JkZW4lMjBvZiUyMGRyaW5rZW4uJTIyJTdEJTdEJTdE" },
  { id: "seed-3", name: "Student hardcore", author: "Huis 42", lang: "nl", uses: 54, likes: 18, created_at: "2026-05-25",
    code: "KGS1.JTdCJTIybiUyMiUzQSUyMlN0dWRlbnQlMjBoYXJkY29yZSUyMiUyQyUyMmwlMjIlM0ElMjJubCUyMiUyQyUyMmQlMjIlM0ElN0IlMjIyJTIyJTNBJTdCJTIydCUyMiUzQSUyMlNob3RzJTIyJTJDJTIyeCUyMiUzQSUyMiU3QnNwZWxlciU3RCUyMGRlZWx0JTIwMiUyMHNob3RzJTIwdWl0LiUyMiU3RCUyQyUyMjMlMjIlM0ElN0IlMjJ0JTIyJTNBJTIyQWNodGVyb3ZlciUyMiUyQyUyMnglMjIlM0ElMjIlN0JzcGVsZXIlN0QlMjBuZWVtdCUyMDQlMjBzbG9ra2VuLiUyMiU3RCUyQyUyMjUlMjIlM0ElN0IlMjJ0JTIyJTNBJTIyRHVpbS1iYWFzJTIyJTJDJTIyeCUyMiUzQSUyMkxhYXRzdGUlMjBkaWUlMjB2b2xndCUyMG5lZW10JTIwZWVuJTIwc2hvdC4lMjIlMkMlMjJlJTIyJTNBJTIydGh1bWJtYXN0ZXIlMjIlN0QlMkMlMjIxMCUyMiUzQSU3QiUyMnQlMjIlM0ElMjJHcm9lcHNzaG90JTIyJTJDJTIyeCUyMiUzQSUyMkllZGVyZWVuJTIwZWVuJTIwc2hvdCUyQyUyMG51ISUyMiU3RCU3RCU3RA==" },
  { id: "seed-4", name: "Office party", author: "HR Dave", lang: "en", uses: 31, likes: 9, created_at: "2026-05-27",
    code: "KGS1.JTdCJTIybiUyMiUzQSUyMk9mZmljZSUyMHBhcnR5JTIyJTJDJTIybCUyMiUzQSUyMmVuJTIyJTJDJTIyZCUyMiUzQSU3QiUyMjQlMjIlM0ElN0IlMjJ0JTIyJTNBJTIyQnV6endvcmRzJTIyJTJDJTIyeCUyMiUzQSUyMlRha2UlMjB0dXJucyUyMG5hbWluZyUyMG9mZmljZSUyMGJ1enp3b3Jkcy4lMjBGYWlsJTIwJTNEJTIwZHJpbmsuJTIyJTdEJTJDJTIyOCUyMiUzQSU3QiUyMnQlMjIlM0ElMjJOZXclMjBwb2xpY3klMjIlMkMlMjJ4JTIyJTNBJTIyJTdCcGxheWVyJTdEJTIwbWFrZXMlMjBhJTIwcnVsZSUyMGZvciUyMHRoZSUyMHJlc3QlMjBvZiUyMHRoZSUyMG5pZ2h0LiUyMiU3RCUyQyUyMlElMjIlM0ElN0IlMjJ0JTIyJTNBJTIyUXVlc3Rpb24lMjBtYXN0ZXIlMjIlMkMlMjJ4JTIyJTNBJTIyJTdCcGxheWVyJTdEJTIwaXMlMjB0aGUlMjBxdWVzdGlvbiUyMG1hc3Rlci4lMjBBbnN3ZXIlMjAlM0QlMjBkcmluay4lMjIlN0QlN0QlN0Q=" },
];

export function seedInto(db) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO sets (id, name, author, lang, code, uses, likes, created_at) VALUES (@id, @name, @author, @lang, @code, @uses, @likes, @created_at)"
  );
  let n = 0;
  for (const s of SEED) n += insert.run(s).changes;
  return n;
}
