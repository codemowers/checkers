import { notFound } from "next/navigation";
import AuthenticatedGame from "../../authenticated-game";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) notFound();
  return <AuthenticatedGame gameId={id} />;
}
