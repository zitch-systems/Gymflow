"use client";

import { useEffect, useState } from "react";

export default function MobilePreviewPage() {
  const [gymView, setGymView] = useState(false);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let active = true;
    const selectedGym =
      new URLSearchParams(window.location.search).get("view") === "gym";
    const target = selectedGym ? "/g/ifitness" : "/";

    setGymView(selectedGym);

    fetch(target, { credentials: "same-origin" })
      .then((response) => response.text())
      .then((document) => {
        if (active) setHtml(document);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        display: "grid",
        placeItems: "start center",
        background: "#dfe3ea",
      }}
    >
      <iframe
        title={gymView ? "Gym landing mobile preview" : "GymFlow mobile preview"}
        srcDoc={html}
        style={{
          width: 390,
          height: 844,
          border: 0,
          background: "white",
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
        }}
      />
    </main>
  );
}
