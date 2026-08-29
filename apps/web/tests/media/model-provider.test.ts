import { describe, expect, it } from 'vitest';

import { mediaModelProviderId } from '../../src/media/models';

// mediaModelProviderId is the decision core of ProjectView's BYOK seed guard
// (byokModelSeedForProtocol): the project's creation-time model is only carried
// into the conversation when its provider matches the active protocol. These
// cases mirror that gate's outcomes against the real registry.
describe('mediaModelProviderId', () => {
  it('resolves AIHubMix live-catalogue ids by prefix without the static registry', () => {
    // The live catalogue (50+ ids) is not seeded into IMAGE_MODELS, so the
    // `aihubmix-` namespace must resolve synchronously — this is what lets the
    // AIHubMix seed survive before the async catalogue fetch resolves.
    expect(mediaModelProviderId('aihubmix-qwen-image-2-pro')).toBe('aihubmix');
    expect(mediaModelProviderId('aihubmix-doubao-seedance-2-0-260128')).toBe('aihubmix');
  });

  it('resolves seeded AIHubMix ids to aihubmix', () => {
    expect(mediaModelProviderId('aihubmix-gpt-image-1')).toBe('aihubmix');
  });

  it('resolves static models to their registry provider', () => {
    // vela/gpt-image-2 is the New Project dialog default → provider vela. On a
    // SenseAudio run this !== 'senseaudio', so the guard drops the seed and the
    // user's Settings default is kept.
    expect(mediaModelProviderId('vela/gpt-image-2')).toBe('vela');
    expect(mediaModelProviderId('gpt-image-2')).toBe('openai');
    expect(mediaModelProviderId('senseaudio-image-2.0-260319')).toBe('senseaudio');
    expect(mediaModelProviderId('senseaudio-tts')).toBe('senseaudio');
  });

  it('returns undefined for unknown ids', () => {
    expect(mediaModelProviderId('totally-made-up-model')).toBeUndefined();
    expect(mediaModelProviderId('')).toBeUndefined();
  });
});
