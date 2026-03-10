import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const total = await prisma.match.count({ where: { source: "cricsheet" } });
  console.log("Total cricsheet matches in DB:", total);
  await prisma.$disconnect();
}

main().catch(console.error);
