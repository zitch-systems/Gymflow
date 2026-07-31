export default async function MobilePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const gymView = view === "gym";

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
        src={gymView ? "/g/ifitness" : "/"}
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
