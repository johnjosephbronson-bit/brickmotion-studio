import { createFileRoute } from "@tanstack/react-router";
import { partImageUrlsById } from "../../lib/minifig";

// GET /api/part-image?id=3626pb0912&color=3
// Fetches a BrickLink part picture on the server and returns it from our own origin, so the
// browser can draw it into a texture (img.bricklink.com sends no CORS headers).
// Only URLs built by partImageUrlsById (img.bricklink.com/ItemImage/...) are ever requested.
export const Route = createFileRoute("/api/part-image")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const q = new URL(request.url).searchParams;
        const id = q.get("id") ?? "";
        const colorParam = q.get("color");
        const cid = colorParam && /^\d{1,3}$/.test(colorParam) ? Number(colorParam) : undefined;
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) return new Response("bad part id", { status: 400 });

        for (const url of partImageUrlsById(id, cid)) {
          try {
            const res = await fetch(url, { headers: { accept: "image/*" } });
            const type = res.headers.get("content-type") ?? "";
            if (!res.ok || !type.startsWith("image/")) continue;
            return new Response(await res.arrayBuffer(), {
              headers: {
                "content-type": type,
                "cache-control": "public, max-age=86400",
              },
            });
          } catch {
            // try the next candidate
          }
        }
        return new Response("part image not found", { status: 404 });
      },
    },
  },
});
