export function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/20">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}
