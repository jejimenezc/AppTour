function testOpenDoublesConfirmationWindow() {
  testSetupSinglesEliminationStage();

  // Resolver singles hasta que exista final de oro o finalistas definidos
  for (let step = 0; step < 6; step++) {
    const scheduledSingles = getMatches().filter(match =>
      String(match.phase_type) === 'singles' &&
      String(match.status) === 'scheduled'
    );

    if (!scheduledSingles.length) break;

    scheduledSingles.forEach((match, idx) => {
      submitMatchResult(match.match_id, {
        mode: 'final',
        sets_a: idx % 2 === 0 ? 2 : 1,
        sets_b: idx % 2 === 0 ? 0 : 2,
        submitted_by: 'system-ref',
        submitted_by_role: 'referee',
      });
    });

    progressSinglesBracketsOneRound();
    markGoldFinalistsIfApplicable();

    const finalists = getPlayers().filter(p => toBoolean(p.is_singles_finalist));
    if (finalists.length === 2) break;
  }

  const finalists = getPlayers().filter(p => toBoolean(p.is_singles_finalist));
  Logger.log('Finalists found=%s', finalists.length);
  finalists.forEach(p => Logger.log(JSON.stringify({
    player_id: p.player_id,
    stage: p.singles_status,
    is_singles_finalist: p.is_singles_finalist,
  })));

  if (finalists.length !== 2) {
    throw new Error('No se lograron definir 2 finalistas de oro en el test.');
  }

  openDoublesConfirmationWindow();

  Logger.log('tournament_status=%s', getConfigValue('tournament_status'));

  getPlayers().forEach(p => {
    Logger.log(JSON.stringify({
      player_id: p.player_id,
      is_singles_finalist: p.is_singles_finalist,
      doubles_status: p.doubles_status,
    }));
  });
}

function testManualAndPoolDoublesConfig() {
  testOpenDoublesConfirmationWindow();

  const eligible = getPlayers().filter(p => String(p.doubles_status) === 'eligible');
  if (eligible.length < 6) throw new Error('No hay suficientes elegibles para test');

  // pareja manual 1
  proposePartner(eligible[0].player_id, eligible[1].player_id);
  confirmPartner(eligible[1].player_id);

  // pareja manual 2
  proposePartner(eligible[2].player_id, eligible[3].player_id);
  confirmPartner(eligible[3].player_id);

  // pool
  optIntoPool(eligible[4].player_id);
  optIntoPool(eligible[5].player_id);

  Logger.log(JSON.stringify(getDoublesStatusSummary()));
  Logger.log(JSON.stringify(validateDoublesCut()));
}

function testGenerateDoublesFromCut() {
  testOpenDoublesConfirmationWindow();

  const eligible = getPlayers().filter(p => String(p.doubles_status) === 'eligible');
  if (eligible.length < 8) throw new Error('No hay suficientes elegibles para test');

  // 2 parejas manuales
  proposePartner(eligible[0].player_id, eligible[1].player_id);
  confirmPartner(eligible[1].player_id);

  proposePartner(eligible[2].player_id, eligible[3].player_id);
  confirmPartner(eligible[3].player_id);

  // 4 al pool
  optIntoPool(eligible[4].player_id);
  optIntoPool(eligible[5].player_id);
  optIntoPool(eligible[6].player_id);
  optIntoPool(eligible[7].player_id);

  const blockId = setupDoublesStageFromCut();

  Logger.log('blockId=%s', blockId);
  Logger.log('summary=%s', JSON.stringify(getDoublesStatusSummary()));

  getDoublesTeams().forEach(t => Logger.log(JSON.stringify(t)));
  getDoublesMatches().forEach(m => Logger.log(JSON.stringify({
    match_id: m.match_id,
    round_no: m.round_no,
    stage: m.stage,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    block_id: m.block_id,
    status: m.status,
  })));
}

function testProgressDoublesOneRound() {
  testGenerateDoublesFromCut();

  const round1 = getDoublesMatchesByRound(1).filter(m => String(m.status) !== 'auto_closed');

  round1.forEach((match, idx) => {
    submitMatchResult(match.match_id, {
      mode: 'final',
      sets_a: idx % 2 === 0 ? 2 : 1,
      sets_b: idx % 2 === 0 ? 0 : 2,
      submitted_by: 'system-ref',
      submitted_by_role: 'referee',
    });
  });

  const result = progressDoublesOneRound();
  Logger.log(JSON.stringify(result));
}