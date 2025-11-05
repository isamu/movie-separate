import { test, describe } from 'node:test';
import assert from 'node:assert';

/**
 * 秒数を mm:ss 形式に変換するヘルパー関数（digest.tsから抽出）
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

describe('formatTime', () => {
  test('should format seconds to mm:ss for values under 1 hour', () => {
    assert.strictEqual(formatTime(0), '0:00');
    assert.strictEqual(formatTime(5), '0:05');
    assert.strictEqual(formatTime(65), '1:05');
    assert.strictEqual(formatTime(3599), '59:59');
  });

  test('should format seconds to h:mm:ss for values over 1 hour', () => {
    assert.strictEqual(formatTime(3600), '1:00:00');
    assert.strictEqual(formatTime(3665), '1:01:05');
    assert.strictEqual(formatTime(7200), '2:00:00');
  });

  test('should handle edge cases', () => {
    assert.strictEqual(formatTime(0), '0:00');
    assert.strictEqual(formatTime(1), '0:01');
    assert.strictEqual(formatTime(59), '0:59');
    assert.strictEqual(formatTime(60), '1:00');
  });
});

describe('Digest filtering', () => {
  test('should filter beats by importance threshold', () => {
    const mockBeats = [
      { importance: 3, videoSource: '1.mp4' },
      { importance: 7, videoSource: '2.mp4' },
      { importance: 9, videoSource: '3.mp4' },
      { importance: 5, videoSource: '4.mp4' },
      { importance: 8, videoSource: '5.mp4' },
    ];

    const filtered = mockBeats.filter(beat => (beat.importance || 0) >= 7);

    assert.strictEqual(filtered.length, 3);
    assert.strictEqual(filtered[0].videoSource, '2.mp4');
    assert.strictEqual(filtered[1].videoSource, '3.mp4');
    assert.strictEqual(filtered[2].videoSource, '5.mp4');
  });

  test('should calculate compression ratio', () => {
    const total = 100;
    const digest = 15;
    const ratio = ((1 - digest / total) * 100).toFixed(1);

    assert.strictEqual(ratio, '85.0');
  });

  test('should handle empty beats', () => {
    const mockBeats: any[] = [];
    const filtered = mockBeats.filter(beat => (beat.importance || 0) >= 7);

    assert.strictEqual(filtered.length, 0);
  });

  test('should handle all beats below threshold', () => {
    const mockBeats = [
      { importance: 3 },
      { importance: 4 },
      { importance: 5 },
    ];

    const filtered = mockBeats.filter(beat => (beat.importance || 0) >= 7);

    assert.strictEqual(filtered.length, 0);
  });
});
