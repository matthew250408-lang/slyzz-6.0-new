import { and, eq } from "drizzle-orm";
import { countingGameTable, db } from "@workspace/db";

export type CountingAttemptResult =
  | {
      accepted: true;
      count: string;
      previousCount: string;
      previousLastUserId: string | null;
    }
  | {
      accepted: false;
      reason: "same-member" | "wrong-number";
      expectedCount: string;
    };

export async function acceptCountingAttempt(
  channelId: string,
  userId: string,
  submittedCount: string,
): Promise<CountingAttemptResult> {
  return db.transaction(async (transaction) => {
    await transaction
      .insert(countingGameTable)
      .values({ channelId })
      .onConflictDoNothing();

    const [state] = await transaction
      .select()
      .from(countingGameTable)
      .where(eq(countingGameTable.channelId, channelId))
      .for("update");

    if (!state) {
      throw new Error(`Counting state missing for channel ${channelId}`);
    }

    const expectedCount = (BigInt(state.currentCount) + 1n).toString();
    if (state.lastUserId === userId) {
      return { accepted: false, reason: "same-member", expectedCount };
    }

    if (BigInt(submittedCount).toString() !== expectedCount) {
      return { accepted: false, reason: "wrong-number", expectedCount };
    }

    await transaction
      .update(countingGameTable)
      .set({
        currentCount: expectedCount,
        lastUserId: userId,
        updatedAt: new Date(),
      })
      .where(eq(countingGameTable.channelId, channelId));

    return {
      accepted: true,
      count: expectedCount,
      previousCount: state.currentCount,
      previousLastUserId: state.lastUserId,
    };
  });
}

export async function rollbackCountingAttempt(
  channelId: string,
  acceptedCount: string,
  userId: string,
  previousCount: string,
  previousLastUserId: string | null,
): Promise<boolean> {
  const rolledBack = await db
    .update(countingGameTable)
    .set({
      currentCount: previousCount,
      lastUserId: previousLastUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(countingGameTable.channelId, channelId),
        eq(countingGameTable.currentCount, acceptedCount),
        eq(countingGameTable.lastUserId, userId),
      ),
    )
    .returning({ channelId: countingGameTable.channelId });

  return rolledBack.length > 0;
}

export async function resetCountingGame(channelId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .insert(countingGameTable)
      .values({ channelId })
      .onConflictDoNothing();

    await transaction
      .update(countingGameTable)
      .set({
        currentCount: "0",
        lastUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(countingGameTable.channelId, channelId));
  });
}
