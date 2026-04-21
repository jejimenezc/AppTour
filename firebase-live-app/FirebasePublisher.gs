const FIREBASE_PARTIDOS_PUBLISH_URL =
  'https://appttour-default-rtdb.firebaseio.com/partidos.json?auth=lt5kKHnJGZMrT0pL2ZxokPLk8zFzu22G9VlmQ8ws';

function publishPartidosToFirebase() {
  const publicVm = getPublicViewModel();
  const payload = buildPartidosFirebasePayload_(publicVm);
  const response = UrlFetchApp.fetch(FIREBASE_PARTIDOS_PUBLISH_URL, {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Firebase publish failed (${statusCode}): ${body}`);
  }

  return {
    ok: true,
    statusCode: statusCode,
    publishedMatches: payload.matches.length,
    body: body,
  };
}

function buildPartidosFirebasePayload_(publicVm) {
  const vm = publicVm || {};
  const matches = Array.isArray(vm.matches) ? vm.matches : [];

  return {
    tournamentStatus: String(vm.tournamentStatus || '').trim(),
    currentBlock: vm.currentBlock || null,
    generatedAt: String(vm.generatedAt || '').trim(),
    matches: matches.map(function (match) {
      return {
        matchId: String(match && match.matchId || '').trim(),
        tableNo: match && Object.prototype.hasOwnProperty.call(match, 'tableNo') ? match.tableNo : '',
        phaseType: String(match && match.phaseType || '').trim(),
        phaseLabel: String(match && match.phaseLabel || '').trim(),
        leftLabel: String(match && match.leftLabel || '').trim(),
        rightLabel: String(match && match.rightLabel || '').trim(),
        matchupLabel: String(match && match.matchupLabel || '').trim(),
        refereeLabel: String(match && match.refereeLabel || '').trim(),
        status: String(match && match.status || '').trim(),
        resultMode: String(match && match.resultMode || '').trim(),
        closingState: String(match && match.closingState || '').trim(),
        setsA: match && Object.prototype.hasOwnProperty.call(match, 'setsA') ? match.setsA : '',
        setsB: match && Object.prototype.hasOwnProperty.call(match, 'setsB') ? match.setsB : '',
      };
    }),
  };
}
