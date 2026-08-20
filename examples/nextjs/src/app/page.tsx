import Link from "next/link";
import { Card } from "@/components/Card";
import { Spread } from "@/components/Spread";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8 font-sans">
      <h1 className="text-2xl font-bold">swc-plugin-jsx-source-attrs</h1>
      <p>
        Inspect any element below: every one written in this project carries a{" "}
        <code>data-source-path</code> attribute.
      </p>

      <Card title="Nested host elements">
        <ul className="list-disc pl-5">
          <li>each element gets its own line and column</li>
          <li>
            including <strong>inline</strong> ones
          </li>
        </ul>
      </Card>

      <Card title="Fragment">
        <>
          <span>a fragment emits no host node, </span>
          <span>but its children are still annotated</span>
        </>
      </Card>

      <Card title="Props spread">
        <Spread className="italic">
          this paragraph keeps the position of the <code>&lt;Spread&gt;</code>{" "}
          call site, not the one inside the component
        </Spread>
      </Card>

      <Card title="Hand-written attribute">
        <em data-source-path="written-by-hand">an existing value is preserved</em>
      </Card>

      <Card title="Library component">
        <Link href="/" className="underline">
          the anchor next/link renders internally stays untouched
        </Link>
      </Card>
    </main>
  );
}
