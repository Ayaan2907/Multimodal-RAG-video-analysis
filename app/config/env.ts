import { z } from "zod";
import { Logger } from "@/utils/logger";

const logger = new Logger("Config:Env");

// Schema for environment variables
const envSchema = z.object({
  NODE_ENV: z.string(),
  NEXT_PUBLIC_APP_URL: z.string(),
  GOOGLE_AI_API_KEY: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
  ASSEMBLYAI_API_KEY: z.string(),
  YOUTUBE_API_KEY: z.string(),
  GROQ_API_KEY: z.string(),
  TEMP_DIR: z.string(),
  MAX_VIDEO_DURATION_MINUTES: z.string(),
  TRANSCRIPTION_PROVIDER: z.string(),
  CHUNK_DURATION_SECONDS: z.string(),
});

// Function to validate environment variables
const validateEnv = () => {
  try {
    logger.info("Validating environment variables");
    const env = {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      TEMP_DIR: process.env.TEMP_DIR || '/tmp',
      MAX_VIDEO_DURATION_MINUTES: process.env.MAX_VIDEO_DURATION_MINUTES,
      TRANSCRIPTION_PROVIDER: process.env.TRANSCRIPTION_PROVIDER,
      CHUNK_DURATION_SECONDS: process.env.CHUNK_DURATION_SECONDS || '60',
    };
    const parsed = envSchema.parse(env);
    logger.info("Environment variables validated successfully");
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => err.path.join("."));
      logger.error("Invalid environment variables", { error: { missingVars } });
      throw new Error(
        `❌ Invalid environment variables: ${missingVars.join(
          ", "
        )}. Please check your .env file`
      );
    }
    throw error;
  }
};

export const env = validateEnv();