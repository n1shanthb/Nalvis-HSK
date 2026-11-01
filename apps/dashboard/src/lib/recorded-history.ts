import { useEffect, useState } from 'react';
import recordedURL from '../../../../data/research/market_history.json?url';
import { loadHistory } from './chart-data.js';
type Rows = ReturnType<typeof loadHistory>;
let request: Promise<Rows> | undefined;
/** One same-origin fixture request shared by both charts; validated before display. */
export function useRecordedHistory() {
  const [state, setState] = useState<{ rows: Rows; error?: string }>({
    rows: [],
  });
  useEffect(() => {
    let active = true;
    request ??= fetch(recordedURL).then(async (response) => {
      if (!response.ok) throw Error('Recorded history unavailable');
      return loadHistory(await response.json());
    });
    request.then(
      (rows) => {
        if (active) setState({ rows });
      },
      () => {
        if (active)
          setState({ rows: [], error: 'Recorded history unavailable' });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
