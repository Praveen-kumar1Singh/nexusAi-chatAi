import { MongoClient, type Db } from "mongodb";

/**
 * Raised when the database cannot be used because of how this deployment is
 * configured -- a missing variable -- as opposed to Atlas being unreachable.
 *
 * The two are worth separating: they collapsed into one message once, and the
 * "check your Atlas cluster and IP allowlist" advice sent people digging
 * through Network Access while the real fault was an environment variable that
 * was never set on Vercel.
 */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConfigError";
  }
}

/** Shown to the user when Atlas cannot be reached. */
export const DB_UNREACHABLE =
  "Cannot reach the database, so your account was not saved. Check that the " +
  "MongoDB Atlas cluster is running and that this machine's IP is allowed.";

/** Shown to the user when the server was never told where the database is. */
export const DB_MISCONFIGURED =
  "The server is missing its database configuration, so your account was not " +
  "saved. Set MONGODB_URI and MONGODB_DB in the deployment environment " +
  "(on Vercel too -- .env.local is not deployed), then redeploy.";

/**
 * The message to show the user for a failure out of `getDb`, telling a
 * misconfigured deployment apart from an unreachable one. `cause` is followed
 * because `session.ts` wraps failures in SessionStoreDown.
 */
export function dbErrorMessage(err: unknown): string {
  for (let e = err, hops = 0; e && hops < 5; e = (e as Error).cause, hops++) {
    if (e instanceof DbConfigError) return DB_MISCONFIGURED;
  }
  return DB_UNREACHABLE;
}

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri) throw new DbConfigError("MONGODB_URI is not set in environment variables");

  // Refusing here is the whole point. `client.db(undefined)` does not fail: it
  // falls back to the database named in the connection string, and this URI
  // names none, so the driver silently uses `test`. That is how accounts and
  // sessions ended up in `test` while the Python agent, which defaults to
  // `mantraa_ai`, wrote conversations to the other database -- two halves of
  // one app on two databases, each working perfectly on its own.
  if (!dbName) {
    throw new DbConfigError(
      "MONGODB_DB is not set. Without it the driver falls back to the `test` " +
        "database and this app splits across two, so it is refused rather than " +
        "guessed. Set MONGODB_DB (mantraa_ai) in the environment -- including " +
        "on Vercel, where .env.local is not deployed.",
    );
  }

  if (!client) {
    const pending = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    try {
      await pending.connect();
    } catch (err) {
      // Leave `client` null so the next request retries instead of reusing a
      // client that never finished connecting.
      await pending.close().catch(() => {});
      throw err;
    }
    client = pending;
  }
  return client.db(dbName);
}
