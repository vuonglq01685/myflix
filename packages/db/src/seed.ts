/**
 * Idempotent seed (doc 04 §8): one ADMIN account from the environment, its
 * default profile, and the 18 standard genres. Safe to re-run.
 */
import { PrismaClient } from "../generated/client";
import { hashPassword } from "@myflix/shared";

const prisma = new PrismaClient();

const GENRES: Array<[slug: string, name: string]> = [
  ["action", "Hành động"],
  ["adventure", "Phiêu lưu"],
  ["animation", "Hoạt hình"],
  ["comedy", "Hài"],
  ["crime", "Tội phạm"],
  ["documentary", "Tài liệu"],
  ["drama", "Chính kịch"],
  ["family", "Gia đình"],
  ["fantasy", "Giả tưởng"],
  ["history", "Lịch sử"],
  ["horror", "Kinh dị"],
  ["music", "Âm nhạc"],
  ["mystery", "Bí ẩn"],
  ["romance", "Lãng mạn"],
  ["sci-fi", "Khoa học viễn tưởng"],
  ["thriller", "Gay cấn"],
  ["war", "Chiến tranh"],
  ["western", "Miền Tây"],
];

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set before seeding",
    );
  }

  await prisma.$transaction(
    GENRES.map(([slug, name], index) =>
      prisma.genre.upsert({
        where: { slug },
        update: { name, sortOrder: index },
        create: { slug, name, sortOrder: index },
      }),
    ),
  );

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", isActive: true },
    create: {
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
    },
  });

  await prisma.profile.upsert({
    where: { userId_name: { userId: admin.id, name: "Admin" } },
    update: {},
    create: { userId: admin.id, name: "Admin" },
  });

  console.log(`seeded ${GENRES.length} genres and admin ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
