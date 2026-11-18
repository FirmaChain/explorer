import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Vue from 'vue';
import numeral from 'numeral';
import { findAll, loadProduct, mount, text } from './helpers/validator-renderer.mjs';

test('proposal detail Tally keeps Turnout as 1 row and combines Yes, No, No With Veto, Abstain into 1 stacked bar', async () => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const abci = await loadProduct('src/libs/abci.ts', {
    'cross-fetch': fetch,
    '@/types': types,
  });
  const govHelpers = await loadProduct('src/libs/govHelpers.ts', {
    '@/libs/abci': abci,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  let resolveProposal;
  const proposalPromise = new Promise((resolve) => {
    resolveProposal = resolve;
  });

  const MdEditorStub = {
    name: 'MdPreview',
    props: ['modelValue', 'theme', 'previewTheme'],
    render() {
      return null;
    },
  };

  const EmptyStub = { render: () => null };

  const Component = await loadProduct(
    'src/modules/[chain]/gov/[proposal_id].vue',
    {
      '@vue/reactivity': Vue,
      'md-editor-v3': { MdPreview: MdEditorStub },
      '@/components/dynamic/ObjectElement.vue': EmptyStub,
      '@/components/Countdown.vue': EmptyStub,
      '@/components/ProposalDeposits.vue': EmptyStub,
      '@/components/ProposalVotes.vue': EmptyStub,
      '@/components/ProposalNonVoters.vue': EmptyStub,
      '@/libs/abci': { resolveRpcEndpoint: () => '' },
      '@/libs/govHelpers': govHelpers,
      '@/stores': {
        useBaseStore: () => ({
          theme: 'light',
          blocktime: 6000,
          latest: { block: { header: { height: '100' } } },
        }),
        useBlockchain: () => ({
          chainName: 'firmachain',
          current: {},
          rpc: {},
        }),
        useFormatter: () => ({
          percent(decimal) {
            return decimal ? numeral(decimal).format('0.[00]%') : '-';
          },
          toDay: (v) => String(v || ''),
          multiLine: (v) => String(v || ''),
        }),
        useGovStore: () => ({
          fetchProposal: () => proposalPromise,
          fetchTally: async () => ({
            tally: {
              yes: '600',
              no: '200',
              no_with_veto: '50',
              abstain: '150',
            },
          }),
        }),
        useStakingStore: () => ({
          pool: { bonded_tokens: '2000' },
        }),
        useTxDialog: () => ({
          open: () => {},
        }),
      },
    }
  );

  const { app, container } = mount(Component.default, {
    proposal_id: '42',
    chain: 'firmachain',
  });

  resolveProposal({
    proposal: {
      proposal_id: '42',
      title: 'Test Proposal',
      status: 'PROPOSAL_STATUS_VOTING_PERIOD',
      submit_time: '2026-01-01T00:00:00Z',
      deposit_end_time: '2026-01-02T00:00:00Z',
      voting_start_time: '2026-01-02T00:00:00Z',
      voting_end_time: '2026-01-09T00:00:00Z',
      final_tally_result: { yes: '0', no: '0', no_with_veto: '0', abstain: '0' },
    },
  });

  await new Promise((r) => setTimeout(r, 20));
  await Vue.nextTick();

  const headerStatuses = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-header-status')
  );
  assert.equal(headerStatuses.length, 1);
  assert.equal(text(headerStatuses[0]).trim(), 'VOTING_PERIOD');
  assert.match(headerStatuses[0].props.class, /rounded-md/);
  assert.match(headerStatuses[0].props.class, /text-sm/);
  assert.match(headerStatuses[0].props.class, /bg-info\/20/);

  const turnoutRows = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-row')
  );
  assert.equal(turnoutRows.length, 1);
  assert.match(text(turnoutRows[0]), /Turnout/);
  assert.match(text(turnoutRows[0]), /50\.00%/);
  const turnoutBars = findAll(
    turnoutRows[0],
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-bar')
  );
  assert.equal(turnoutBars.length, 1);
  assert.equal(turnoutBars[0].props.style.width, '50.00%');
  const turnoutNotes = findAll(
    turnoutRows[0],
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-note')
  );
  assert.equal(turnoutNotes.length, 1);
  assert.match(text(turnoutNotes[0]), /Turnout is a live estimate/);

  const tallyBars = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-tally-bar')
  );
  assert.equal(tallyBars.length, 1);
  const segments = tallyBars[0].children.filter((c) => c.type === 'div');
  assert.equal(segments.length, 4);
  assert.deepEqual(
    segments.map((s) => s.props.style.width),
    ['60%', '20%', '5%', '15%']
  );

  const voteSummaries = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-votes-summary')
  );
  assert.equal(voteSummaries.length, 1);
  const summaryText = text(voteSummaries[0]);
  assert.match(summaryText, /Yes/);
  assert.match(summaryText, /60%/);
  assert.match(summaryText, /No/);
  assert.match(summaryText, /20%/);
  assert.match(summaryText, /No With Veto/);
  assert.match(summaryText, /5%/);
  assert.match(summaryText, /Abstain/);
  assert.match(summaryText, /15%/);

  app.unmount();
});

test('proposal detail Tally handles zero votes cleanly', async () => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const abci = await loadProduct('src/libs/abci.ts', {
    'cross-fetch': fetch,
    '@/types': types,
  });
  const govHelpers = await loadProduct('src/libs/govHelpers.ts', {
    '@/libs/abci': abci,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  const MdEditorStub = { render: () => null };
  const EmptyStub = { render: () => null };

  const Component = await loadProduct(
    'src/modules/[chain]/gov/[proposal_id].vue',
    {
      '@vue/reactivity': Vue,
      'md-editor-v3': { MdPreview: MdEditorStub },
      '@/components/dynamic/ObjectElement.vue': EmptyStub,
      '@/components/Countdown.vue': EmptyStub,
      '@/components/ProposalDeposits.vue': EmptyStub,
      '@/components/ProposalVotes.vue': EmptyStub,
      '@/components/ProposalNonVoters.vue': EmptyStub,
      '@/libs/abci': { resolveRpcEndpoint: () => '' },
      '@/libs/govHelpers': govHelpers,
      '@/stores': {
        useBaseStore: () => ({
          theme: 'light',
          blocktime: 6000,
          latest: { block: { header: { height: '100' } } },
        }),
        useBlockchain: () => ({
          chainName: 'firmachain',
          current: {},
          rpc: {},
        }),
        useFormatter: () => ({
          percent(decimal) {
            return decimal ? numeral(decimal).format('0.[00]%') : '-';
          },
          toDay: (v) => String(v || ''),
          multiLine: (v) => String(v || ''),
        }),
        useGovStore: () => ({
          fetchProposal: async () => ({
            proposal: {
              proposal_id: '1',
              title: 'Zero Votes Proposal',
              status: 'PROPOSAL_STATUS_DEPOSIT_PERIOD',
              submit_time: '2026-01-01T00:00:00Z',
              deposit_end_time: '2026-01-02T00:00:00Z',
              voting_start_time: '2026-01-02T00:00:00Z',
              voting_end_time: '2026-01-09T00:00:00Z',
              final_tally_result: {
                yes: '0',
                no: '0',
                no_with_veto: '0',
                abstain: '0',
              },
            },
          }),
          fetchTally: async () => ({ tally: {} }),
        }),
        useStakingStore: () => ({
          pool: { bonded_tokens: '0' },
        }),
        useTxDialog: () => ({ open: () => {} }),
      },
    }
  );

  const { app, container } = mount(Component.default, {
    proposal_id: '1',
    chain: 'firmachain',
  });

  await new Promise((r) => setTimeout(r, 20));
  await Vue.nextTick();

  const headerStatuses = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-header-status')
  );
  assert.equal(headerStatuses.length, 1);
  assert.equal(text(headerStatuses[0]).trim(), 'DEPOSIT_PERIOD');
  assert.match(headerStatuses[0].props.class, /rounded-md/);
  assert.match(headerStatuses[0].props.class, /text-sm/);
  assert.match(headerStatuses[0].props.class, /bg-info\/20/);

  const turnoutRows = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-row')
  );
  assert.equal(turnoutRows.length, 1);
  assert.match(text(turnoutRows[0]), /Turnout/);
  assert.doesNotMatch(text(turnoutRows[0]), /100%/);
  const turnoutBarText = text(turnoutRows[0].children.find((c) => c.type === 'div'));
  assert.equal(turnoutBarText.trim(), '-');
  const turnoutBars = findAll(
    turnoutRows[0],
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-bar')
  );
  assert.equal(turnoutBars.length, 1);
  assert.equal(turnoutBars[0].props.style.width, '0%');
  const turnoutNotes = findAll(
    turnoutRows[0],
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-turnout-note')
  );
  assert.equal(turnoutNotes.length, 1);
  assert.match(text(turnoutNotes[0]), /Turnout unavailable:/);

  const tallyBars = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-tally-bar')
  );
  assert.equal(tallyBars.length, 1);
  const segments = tallyBars[0].children.filter((c) => c.type === 'div');
  assert.deepEqual(
    segments.map((s) => s.props.style.width),
    ['0%', '0%', '0%', '0%']
  );

  app.unmount();
});

test('ProposalListItem omits ProposalProcess, renders rounded-rect status badge, and displays YYYY-MM-DD date', async () => {
  const Component = await loadProduct('src/components/ProposalListItem.vue', {
    '@/components/dynamic/index': { select: () => 'div' },
    '@/stores': {
      useBlockchain: () => ({ chainName: 'firmachain' }),
      useFormatter: () => ({
        toDay: (v, fmt) =>
          fmt === 'date' ? String(v || '').slice(0, 10) : String(v || ''),
      }),
      useTxDialog: () => ({ open: () => {} }),
    },
  });

  const { app, container } = mount(Component.default, {
    proposals: {
      proposals: [
        {
          proposal_id: '10',
          title: 'Upgrade Chain',
          status: 'PROPOSAL_STATUS_PASSED',
          voting_end_time: '2026-01-09T00:00:00Z',
          content: { '@type': '/cosmos.upgrade.v1beta1.SoftwareUpgradeProposal' },
        },
      ],
    },
  });

  await Vue.nextTick();

  const progressBars = findAll(
    container,
    (el) =>
      el.props &&
      typeof el.props.class === 'string' &&
      el.props.class.includes('progress')
  );
  assert.equal(progressBars.length, 0);

  const statusCells = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-status')
  );
  assert.equal(statusCells.length, 1);
  assert.equal(text(statusCells[0]).trim(), 'PASSED');
  const statusBadges = findAll(
    statusCells[0],
    (el) =>
      el.props &&
      typeof el.props.class === 'string' &&
      el.props.class.includes('rounded-md') &&
      el.props.class.includes('text-sm') &&
      el.props.class.includes('bg-yes/20')
  );
  assert.equal(statusBadges.length, 1);
  const statusDots = findAll(
    statusCells[0],
    (el) =>
      el.props &&
      typeof el.props.class === 'string' &&
      el.props.class.includes('rounded-full')
  );
  assert.equal(statusDots.length, 0);

  const dateCells = findAll(
    container,
    (el) => el.props && Object.hasOwn(el.props, 'data-proposal-date')
  );
  assert.equal(dateCells.length, 1);
  assert.equal(text(dateCells[0]).trim(), '2026-01-09');
  assert.match(dateCells[0].props.class, /text-sm/);

  app.unmount();
});
