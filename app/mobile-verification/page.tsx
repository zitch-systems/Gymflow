"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function MobilePreviewPage() {
  const searchParams = useSearchParams();
  const gymView = searchParams.get("view") === "gym";
  const target = gymView ? "/g/ifitness" : "/";
  const [html, setHtml] = useState("");

  useEffect(() => {
    let active = true;

    fetch(target, { credentials: "same-origin" })
      .then((response) => response.text())
      .then((document) => {
        if (active) setHtml(document);
      });

    return () => {
      active = false;
    };
  }, [target]);

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
