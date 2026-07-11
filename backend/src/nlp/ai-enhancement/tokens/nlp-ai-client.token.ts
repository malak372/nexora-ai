/**
 * Dependency injection token used to resolve an implementation of
 * the NLP AI client.
 *
 * This token decouples the NLP enhancement layer from the AI
 * execution layer, allowing the underlying implementation to be
 * provided through NestJS dependency injection.
 *
 * The NLP module depends only on the NlpAiClient contract and
 * remains independent of provider SDKs and AI execution services.
 *
 * @author Eman
 */
export const NLP_AI_CLIENT = Symbol('NLP_AI_CLIENT');
