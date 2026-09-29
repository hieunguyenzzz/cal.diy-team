import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { slotsRouter } from "@calcom/trpc/server/routers/viewer/slots/_router";
import { applyStorefrontCors } from "@lib/storefrontCors";
import type { NextApiRequest, NextApiResponse } from "next";

const trpcHandler = createNextApiHandler(slotsRouter);

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  applyStorefrontCors(req, res);
  await trpcHandler(req, res);
}
