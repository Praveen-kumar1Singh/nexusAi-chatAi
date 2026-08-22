import { MongoClient, type Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

/** Shown to the user when Atlas cannot be reached. */
export const DB_UNREACHABLE =
  "Cannot reach the database, so your account was not saved. Check that the " +
  "MongoDB Atlas cluster is running and that this machine's IP is allowed.";

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri) throw new Error("MONGODB_URI is not set in environment variables");

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
