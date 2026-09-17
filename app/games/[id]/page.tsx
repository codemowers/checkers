import { notFound } from "next/navigation";
import AuthenticatedGame from "../../authenticated-game";

export const dynamic = "force-dynamic";

export default function GamePage({ params }: { params: { id: string } }) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(params.id)) notFound();
  return <AuthenticatedGame gameId={params.id} />;
}
