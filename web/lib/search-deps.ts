import type { Dependencies } from './recommend.ts';
import { candidates, runtime } from './store.ts';
import { jevConfigFrom, rankWithJev } from './jev.ts';
import { voyageConfigFrom, embedWithVoyage } from './voyage.ts';
import { interpretSpanInput } from './span-interpreter.ts';
import { inputInterpreterFrom, inputReaderFrom } from './interpreter-config.ts';
import { interpretInput } from './input-interpreter.ts';
import { voyageVectorsFor } from './voyage-index.ts';
import { fetchWithSignal } from './deadline.ts';

export type Measure = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
export type SpanParse = Awaited<ReturnType<typeof interpretSpanInput>>;

const unmeasured: Measure = (_name, operation) => operation();

/** True when a search can make paid Jev or Voyage calls. */
export function paidSearchConfigured() {
  return Boolean(jevConfigFrom(runtime()) || voyageConfigFrom(runtime()));
}

/**
 * Builds the production search dependencies. The recommend route and the
 * agent's `search_events` tool use the same wiring.
 */
export function searchDependencies(options: {
  now: Date;
  signal: AbortSignal;
  measured?: Measure;
  onParse?: (parse: SpanParse) => void;
}): Dependencies {
  const measured = options.measured ?? unmeasured;
  const config = jevConfigFrom(runtime());
  const providerFetch = fetchWithSignal(options.signal);
  return {
    now: options.now,
    candidates: (filters) => measured('candidates', () => candidates(filters)),
    config,
    embeddingConfig: voyageConfigFrom(runtime()),
    vectors: (events, config) =>
      measured('vectors', () => voyageVectorsFor(events, config)),
    interpret: (input, interpretOptions) =>
      measured('interpret', () =>
        interpretInput(input, { ...interpretOptions, fetcher: providerFetch }),
      ),
    embed: (config, texts, kind) =>
      measured('query_embedding', () =>
        embedWithVoyage(config, texts, kind, providerFetch),
      ),
    rank: (config, input, events) =>
      measured('rank', () => rankWithJev(config, input, events, providerFetch)),
    spanInterpret: async (input, interpretOptions) => {
      const parse = await measured('interpret', () =>
        interpretSpanInput(input, { ...interpretOptions, fetcher: providerFetch }),
      );
      options.onParse?.(parse);
      return parse;
    },
    inputInterpreter: inputInterpreterFrom(runtime(), Boolean(config)),
    inputReader: inputReaderFrom(runtime()),
  };
}
