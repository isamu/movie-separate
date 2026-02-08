import ffmpeg from "fluent-ffmpeg";
// import { Segment } from "./types.js";
import { promises as fs } from "fs";
import path from "path";

export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration || 0);
      }
    });
  });
}

export async function extractAudioFromVideo(
  videoPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(outputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function splitVideo(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .output(outputPath)
      .videoCodec("copy")
      .audioCodec("copy")
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function splitAudio(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .output(outputPath)
      .audioCodec("libmp3lame")
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function ensureOutputDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * 動画からサムネイル画像を生成
 * @param videoPath 入力動画ファイルのパス
 * @param outputPath 出力画像ファイルのパス
 * @param timestamp サムネイルを取得する時間（秒）、デフォルトは最初のフレーム
 */
export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp: number = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: "640x?", // 幅640px、高さは自動
      })
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}
