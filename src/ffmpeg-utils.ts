import ffmpeg from 'fluent-ffmpeg';
import { Segment } from './types.js';
import { promises as fs } from 'fs';
import path from 'path';

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
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(outputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function splitVideo(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .output(outputPath)
      .videoCodec('copy')
      .audioCodec('copy')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function splitAudio(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .output(outputPath)
      .audioCodec('libmp3lame')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
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
