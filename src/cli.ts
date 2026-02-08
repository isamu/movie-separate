/**
 * CLI argument parsing with yargs
 */
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliOptions {
  input: string;
  lang: string;
  test: boolean;
  testDuration: number;
  output?: string;
}

export function parseArgs(args: string[]): CliOptions {
  const argv = yargs(hideBin(args))
    .command(
      "$0 <input>",
      "Process video with AI transcription and translation",
      (yargs) => {
        return yargs.positional("input", {
          describe: "Input video file (required)",
          type: "string",
          demandOption: true,
        });
      },
    )
    .option("lang", {
      alias: "l",
      type: "string",
      description: "Source language of the video (en or ja)",
      default: "en",
      choices: ["en", "ja"],
    })
    .option("test", {
      alias: "t",
      type: "boolean",
      description: "Test mode: process only first 5 minutes",
      default: false,
    })
    .option("output", {
      alias: "o",
      type: "string",
      description: "Output directory (default: output/<video-name>)",
    })
    .example("$0 video.mp4", "Process video.mp4 with default settings")
    .example("$0 video.mp4 --lang ja", "Process Japanese video")
    .example("$0 --test video.mp4", "Test mode: process first 5 minutes only")
    .help()
    .alias("help", "h")
    .version("1.0.0")
    .alias("version", "v")
    .strict()
    .parseSync();

  if (!argv.input) {
    console.error("Error: Input video file is required");
    process.exit(1);
  }

  return {
    input: argv.input as string,
    lang: argv.lang as string,
    test: argv.test as boolean,
    testDuration: 5 * 60,
    output: argv.output as string | undefined,
  };
}
