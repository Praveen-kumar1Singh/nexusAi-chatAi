import { MongoClient, type Db } from "mongodb";


/** Shown to the user when Atlas cannot be reached. */
export const DB_UNREACHABLE =
  "Cannot reach the database, so your account was not saved. Check that the " +
  "MongoDB Atlas cluster is running and that this machine's IP is allowed.";

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri) throw new Error("MONGODB_URI is not set in environment variables");

  // Refusing here is the whole point. `client.db(undefined)` does not fail: it
  // falls back to the database named in the connection string, and this URI
  // names none, so the driver silently uses `test`. That is how accounts and
  // sessions ended up in `test` while the Python agent, which defaults to
  // `mantraa_ai`, wrote conversations to the other database -- two halves of
  // one app on two databases, each working perfectly on its own.
  if (!dbName) {
    throw new Error(
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
