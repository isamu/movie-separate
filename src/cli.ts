/**
 * CLI argument parsing utilities
 */

export interface CliOptions {
  inputVideo: string;
  defaultLang: string;
  testMode: boolean;
  testDuration: number;
}

/**
 * Parse command line arguments
 */
export const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {
    inputVideo: 'ai.mp4',
    defaultLang: 'en',
    testMode: args.includes('--test') || args.includes('-t'),
    testDuration: 5 * 60, // 5 minutes
  };

  args.forEach((arg, i) => {
    const nextArg = args[i + 1];

    if ((arg === '--input' || arg === '-i') && nextArg) {
      options.inputVideo = nextArg;
    } else if ((arg === '--lang' || arg === '-l') && nextArg) {
      options.defaultLang = nextArg;
    } else if (!arg.startsWith('-') && arg.endsWith('.mp4')) {
      options.inputVideo = arg;
    }
  });

  return options;
};
