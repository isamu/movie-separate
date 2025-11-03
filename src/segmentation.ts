import { Segment } from './types.js';
import { getVideoDuration } from './ffmpeg-utils.js';
import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SilenceInterval {
  start: number;
  end: number;
}

/**
 * ffmpegのsilencedetectフィルタを使って無音部分を検出
 */
export async function detectSilence(
  videoPath: string,
  noiseThreshold: number = -30, // dB
  minSilenceDuration: number = 0.5 // 秒
): Promise<SilenceInterval[]> {
  return new Promise((resolve, reject) => {
    const silences: SilenceInterval[] = [];
    let currentSilence: Partial<SilenceInterval> = {};

    const command = ffmpeg(videoPath)
      .audioFilters(`silencedetect=noise=${noiseThreshold}dB:d=${minSilenceDuration}`)
      .format('null');

    command.on('stderr', (stderrLine) => {
      // silence_start: 12.3456
      const startMatch = stderrLine.match(/silence_start: ([\d.]+)/);
      if (startMatch) {
        currentSilence.start = parseFloat(startMatch[1]);
      }

      // silence_end: 15.6789 | silence_duration: 3.3333
      const endMatch = stderrLine.match(/silence_end: ([\d.]+)/);
      if (endMatch && currentSilence.start !== undefined) {
        currentSilence.end = parseFloat(endMatch[1]);
        silences.push({
          start: currentSilence.start,
          end: currentSilence.end,
        });
        currentSilence = {};
      }
    });

    command.on('end', () => {
      resolve(silences);
    });

    command.on('error', (err) => {
      reject(err);
    });

    command.output('-').run();
  });
}

/**
 * 無音部分に基づいて動画を分割
 * 20秒〜2分の範囲で、無音部分をセグメント境界として使用
 */
export async function segmentVideoByAudioSilence(
  videoPath: string,
  minDuration: number = 20,
  maxDuration: number = 120
): Promise<Segment[]> {
  const totalDuration = await getVideoDuration(videoPath);

  console.log('🔍 Detecting silence in audio...');
  const silences = await detectSilence(videoPath);
  console.log(`Found ${silences.length} silence intervals`);

  if (silences.length === 0) {
    // 無音が検出されない場合は固定時間で分割
    console.log('⚠️  No silence detected, using fixed-duration segmentation');
    return segmentVideoFixed(videoPath, minDuration, maxDuration);
  }

  const segments: Segment[] = [];
  let segmentStart = 0;

  for (let i = 0; i < silences.length; i++) {
    const silence = silences[i];
    const silenceMidpoint = (silence.start + silence.end) / 2;
    const potentialDuration = silenceMidpoint - segmentStart;

    // セグメントが最小時間以上で、最大時間以下の場合、このポイントで分割
    if (potentialDuration >= minDuration) {
      if (potentialDuration <= maxDuration) {
        // 適切な長さなので、ここで分割
        segments.push({
          start: segmentStart,
          end: silenceMidpoint,
        });
        segmentStart = silenceMidpoint;
      } else {
        // 長すぎる場合は、maxDurationに近い無音部分を探す
        // または強制的に分割
        const idealEnd = segmentStart + maxDuration;

        // idealEndに最も近い無音部分を探す
        let closestSilence = silence;
        let closestDistance = Math.abs(silenceMidpoint - idealEnd);

        for (let j = i + 1; j < silences.length; j++) {
          const nextSilence = silences[j];
          const nextMidpoint = (nextSilence.start + nextSilence.end) / 2;

          if (nextMidpoint > idealEnd + 30) break; // 遠すぎる場合は探索終了

          const distance = Math.abs(nextMidpoint - idealEnd);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestSilence = nextSilence;
          }
        }

        const splitPoint = (closestSilence.start + closestSilence.end) / 2;
        segments.push({
          start: segmentStart,
          end: splitPoint,
        });
        segmentStart = splitPoint;
      }
    }
  }

  // 最後のセグメントを追加
  if (segmentStart < totalDuration) {
    const remainingDuration = totalDuration - segmentStart;

    if (remainingDuration >= minDuration || segments.length === 0) {
      segments.push({
        start: segmentStart,
        end: totalDuration,
      });
    } else {
      // 短すぎる場合は最後のセグメントに統合
      if (segments.length > 0) {
        segments[segments.length - 1].end = totalDuration;
      } else {
        segments.push({
          start: 0,
          end: totalDuration,
        });
      }
    }
  }

  return segments;
}

/**
 * 固定時間で動画を分割（フォールバック用）
 */
export async function segmentVideoFixed(
  videoPath: string,
  minDuration: number = 20,
  maxDuration: number = 120
): Promise<Segment[]> {
  const totalDuration = await getVideoDuration(videoPath);
  const segments: Segment[] = [];

  let currentTime = 0;

  while (currentTime < totalDuration) {
    const remainingTime = totalDuration - currentTime;
    let segmentDuration: number;

    if (remainingTime <= maxDuration) {
      segmentDuration = remainingTime;
    } else {
      // 60秒をデフォルトのセグメント長とする
      segmentDuration = 60;
    }

    segments.push({
      start: currentTime,
      end: currentTime + segmentDuration,
    });

    currentTime += segmentDuration;
  }

  return segments;
}

// デフォルトエクスポートは無音検出版
export async function segmentVideo(
  videoPath: string,
  minDuration: number = 20,
  maxDuration: number = 120
): Promise<Segment[]> {
  return segmentVideoByAudioSilence(videoPath, minDuration, maxDuration);
}
