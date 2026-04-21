// Asset sizes (pre-base64):
//   background.jpg    132 KB  (sips JPEG q72 from 1.2 MB PNG)
//   player.png        535 KB  (loaded as plain image; frames registered manually in Player.ts)
//   enemy.png         579 KB  (4-col × 2-row spritesheet, 350×376 frames, 8 frames)
//   coins.png         421 KB  (5-col × 2-row spritesheet, 281×384 frames, 8 frames spin)
//   balls.png         314 KB  (5-col × 2-row spritesheet, 281×384 frames, frame 0 static)
//   footer_large.webp  76 KB
//   footer.webp        47 KB
//   Total assets      ~2.1 MB → ~2.8 MB base64-encoded
//   Phaser 3 bundle   ~1.4 MB (minified)
//   Actual dist/index.html   ~3.9 MB  (under 5 MB limit)
import { defineConfig, Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(async () => {
  const analyze = process.env.ANALYZE === "true";
  const extraPlugins: Plugin[] = [];

  if (analyze) {
    const { visualizer } = await import("rollup-plugin-visualizer");
    extraPlugins.push(
      visualizer({ open: true, filename: "dist/stats.html" }) as Plugin,
    );
  }

  return {
    plugins: [viteSingleFile(), ...extraPlugins],
    build: {
      target: "esnext",
      assetsInlineLimit: 10_000_000,
      chunkSizeWarningLimit: 10_000_000,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
