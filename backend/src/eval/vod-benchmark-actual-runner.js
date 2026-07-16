import { extractVodTopicsWithDiagnostics } from '../services/llm.service.js';
import { ensureTranscript } from '../services/transcript.service.js';
import { getVideoMetadata } from '../services/video-metadata.service.js';
import {
  assessTitleTranscriptAlignment,
  assessVodClaimMaterial,
  resolveVodTopicExtractionResult,
  selectFactCheckableVodTopics,
} from '../services/vod-pipeline.service.js';

const asArray = (value) => Array.isArray(value) ? value : [];

const transcriptText = (segments = []) => asArray(segments).map(segment => segment?.text || '').join(' ').trim();

const technicalFailure = (reason, details = {}) => ({
  status: 'technical_failure',
  failureReason: reason,
  cards: [],
  metrics: {
    llmCallAvoided: false,
    rawTopics: 0,
    selectedTopics: 0,
    ...(details.metrics || {}),
  },
  ...(details.errorMessage ? { errorMessage: details.errorMessage } : {}),
});

const topicToBenchmarkCard = (topic = {}) => ({
  topicTitle: topic.topicTitle,
  claim: topic.claim || topic.normalizedClaim || topic.question,
  question: topic.question || topic.viewerQuestion,
  normalizedClaim: topic.normalizedClaim || topic.claim,
  exactQuote: topic.exactQuote,
  mainTopicRole: topic.mainTopicRole,
  videoTopicRelevanceScore: topic.videoTopicRelevanceScore,
  quoteFidelityScore: topic.quoteFidelityScore,
  evidencePath: topic.evidencePath,
});

export const createVodBenchmarkActualRunner = (deps = {}) => {
  const loadTranscript = deps.ensureTranscript || ensureTranscript;
  const extractTopics = deps.extractVodTopicsWithDiagnostics || extractVodTopicsWithDiagnostics;
  const loadMetadata = deps.getVideoMetadata || getVideoMetadata;
  const logger = typeof deps.logger === 'function' ? deps.logger : () => {};

  return async (fixture = {}) => {
    const videoId = fixture.videoId;
    if (!videoId) return technicalFailure('missing_video_id');

    let transcriptSegments;
    try {
      transcriptSegments = await loadTranscript(videoId, fixture);
    } catch (error) {
      return technicalFailure('transcript_error', { errorMessage: error?.message || String(error) });
    }

    if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) {
      return technicalFailure('transcript_unavailable');
    }

    const fullText = transcriptText(transcriptSegments);
    const claimMaterial = assessVodClaimMaterial(fullText, transcriptSegments);
    if (!claimMaterial.isSufficient) {
      return {
        status: 'no_card',
        noCardReason: claimMaterial.reason,
        cards: [],
        metrics: {
          llmCallAvoided: true,
          acceptedQuoteDrift: 0,
          acceptedHallucinatedNumbers: 0,
          rawTopics: 0,
          selectedTopics: 0,
          transcriptChars: claimMaterial.chars,
          transcriptSegments: claimMaterial.segments,
        },
      };
    }

    const videoMeta = loadMetadata(videoId) || {};
    const titleAlignment = assessTitleTranscriptAlignment(videoMeta, transcriptSegments);
    const extractionMeta = titleAlignment.isAligned
      ? videoMeta
      : {
        ...videoMeta,
        title: '',
        videoTitle: '',
        inferredTranscriptTopic: titleAlignment.transcriptKeywords.slice(0, 5).join(' / '),
        originalTitle: videoMeta.title || videoMeta.videoTitle || '',
        titleTranscriptAlignment: titleAlignment,
      };

    let extractionResult;
    try {
      extractionResult = await extractTopics(fullText, videoId, transcriptSegments, extractionMeta, deps.extractorOptions || {});
    } catch (error) {
      return technicalFailure('extractor_exception', { errorMessage: error?.message || String(error) });
    }

    const extractionOutcome = resolveVodTopicExtractionResult(extractionResult, claimMaterial);
    if (extractionOutcome.status === 'technical_failure') {
      logger({ videoId, stage: 'technical_failure', reason: extractionOutcome.reason });
      return technicalFailure(extractionOutcome.reason, {
        errorMessage: extractionOutcome.detail,
        metrics: {
          rawTopics: asArray(extractionOutcome.topics).length,
          selectedTopics: 0,
          attempts: extractionOutcome.attempts,
        },
      });
    }

    const rawTopics = asArray(extractionOutcome.topics);
    if (rawTopics.length === 0) {
      return {
        status: 'no_claims',
        noCardReason: extractionOutcome.reason || 'extractor_returned_empty',
        cards: [],
        metrics: {
          llmCallAvoided: false,
          rawTopics: 0,
          selectedTopics: 0,
          transcriptChars: fullText.length,
          transcriptSegments: transcriptSegments.length,
          titleTranscriptAligned: titleAlignment.isAligned,
          titleMismatchHandled: !titleAlignment.isAligned,
          usedModel: extractionOutcome.usedModel,
        },
      };
    }

    const selectedTopics = selectFactCheckableVodTopics(rawTopics, deps.limit || 5);
    return {
      status: selectedTopics.length > 0 ? 'cards' : 'no_claims',
      noCardReason: selectedTopics.length > 0 ? undefined : 'selected_topics_empty',
      cards: selectedTopics.map(topicToBenchmarkCard),
      metrics: {
        llmCallAvoided: false,
        rawTopics: rawTopics.length,
        selectedTopics: selectedTopics.length,
        transcriptChars: fullText.length,
        transcriptSegments: transcriptSegments.length,
        titleTranscriptAligned: titleAlignment.isAligned,
        titleMismatchHandled: !titleAlignment.isAligned,
        usedModel: extractionOutcome.usedModel,
        degraded: Boolean(extractionOutcome.degraded),
        attempts: extractionOutcome.attempts,
      },
    };
  };
};
