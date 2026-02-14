import React from "react";
import Layout from "@theme/Layout";

export default function Home() {
  return (
    <Layout title="Browser2Video" description="Browser automation → video proofs">
      <main style={{ padding: "2rem 1.5rem", maxWidth: 920, margin: "0 auto" }}>
        <h1>Browser2Video</h1>
        <p>
          Record smooth browser automation videos (MP4 @ 60fps) with subtitles and step metadata.
        </p>
        <h2>Example video</h2>
        <p>Collab scenario demo (human mode, screen recording; includes cursor + reviewer terminal).</p>
        <video
          controls
          muted
          playsInline
          style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)" }}
          src="https://github.com/holiber/browser2video/releases/download/examples-v2/collab-demo.mp4"
        />
        <p>
          Start with the docs: <a href="/browser2video/docs/intro">/docs/intro</a>
        </p>
      </main>
    </Layout>
  );
}

