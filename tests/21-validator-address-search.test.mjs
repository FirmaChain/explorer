import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toBech32 } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, text } from './helpers/validator-renderer.mjs';

const rawAddr = new Uint8Array(20).fill(5);
const firmaAcc = toBech32('firma', rawAddr);
const firmaValoper = toBech32('firmavaloper', rawAddr);
const otherChainAcc = toBech32('cosmos', rawAddr);

const pub = Buffer.alloc(32, 8);
const consBytes = sha256(pub).slice(0, 20);
const firmaValcons = toBech32('firmavalcons', consBytes);
const unknownValcons = toBech32('firmavalcons', new Uint8Array(20).fill(77));

async function createSearchFixture(t, { validatorPages } = {}) {
  const pushed = [];
  const blockchain = reactive({
    chainName: 'firmachain',
    current: {
      chainName: 'firmachain',
      bech32Prefix: 'firma',
      bech32ConsensusPrefix: 'firmavalcons',
    },
    rpc: {
      getStakingValidatorsPage: async (status, page) => {
        if (validatorPages) return validatorPages(status, page);
        if (status === 'BOND_STATUS_BONDED') {
          return {
            validators: [
              {
                operator_address: firmaValoper,
                consensus_pubkey: {
                  '@type': '/cosmos.crypto.ed25519.PubKey',
                  key: toBase64(pub),
                },
              },
            ],
            pagination: {},
          };
        }
        return { validators: [], pagination: {} };
      },
    },
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });

  const component = (
    await loadProduct('src/layouts/components/NavbarSearch.vue', {
      '@/stores': {
        useBlockchain: () => blockchain,
        useStakingStore: () => ({ validators: [], validatorsComplete: {} }),
      },
      '@/libs': addresses,
      '@/libs/stakingConcentration': concentration,
      '@iconify/vue': { Icon: () => null },
      '@cosmjs/encoding': await import('@cosmjs/encoding'),
      'vue-router': {
        useRouter: () => ({
          currentRoute: { value: { params: {} } },
          push: (to) => pushed.push(to),
        }),
      },
    })
  ).default;

  const originalDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  });

  const mounted = mount(component, {});
  t.after(() => mounted.app.unmount());

  // Open search modal
  click(findAll(mounted.container, (el) => el.type === 'button')[0]);
  await nextTick();

  const submit = async (value) => {
    const input = findAll(mounted.container, (el) => el.type === 'input')[0];
    input.props['onUpdate:modelValue'](value);
    await nextTick();
    const form = findAll(mounted.container, (el) => el.type === 'form')[0];
    await form.props.onSubmit({ preventDefault() {} });
    await nextTick();
  };

  return { ...mounted, blockchain, pushed, submit };
}

test('routes account, operator, consensus addresses, block height, and tx hash properly', async (t) => {
  const f = await createSearchFixture(t);

  await f.submit(firmaAcc);
  assert.deepEqual(f.pushed.pop(), { path: `/firmachain/account/${firmaAcc}` });

  // Re-open modal for next searches
  click(findAll(f.container, (el) => el.type === 'button')[0]);
  await nextTick();
  await f.submit(firmaValoper);
  assert.deepEqual(f.pushed.pop(), { path: `/firmachain/staking/${firmaValoper}` });

  click(findAll(f.container, (el) => el.type === 'button')[0]);
  await nextTick();
  await f.submit(firmaValcons);
  assert.deepEqual(f.pushed.pop(), { path: `/firmachain/staking/${firmaValoper}` });

  click(findAll(f.container, (el) => el.type === 'button')[0]);
  await nextTick();
  await f.submit('12345');
  assert.deepEqual(f.pushed.pop(), { path: '/firmachain/block/12345' });

  click(findAll(f.container, (el) => el.type === 'button')[0]);
  await nextTick();
  await f.submit('a'.repeat(64));
  assert.deepEqual(f.pushed.pop(), { path: `/firmachain/tx/${'A'.repeat(64)}` });
});

test('rejects invalid checksum, wrong chain prefix, and unknown consensus address without navigating', async (t) => {
  const f = await createSearchFixture(t);

  // Invalid checksum
  await f.submit(firmaAcc.slice(0, -1) + (firmaAcc.endsWith('a') ? 'b' : 'a'));
  assert.equal(f.pushed.length, 0);
  assert.match(text(f.container), /Invalid Bech32 address checksum/);

  // Wrong chain prefix
  await f.submit(otherChainAcc);
  assert.equal(f.pushed.length, 0);
  assert.match(text(f.container), /does not match firma/);

  // Unknown consensus address
  await f.submit(unknownValcons);
  assert.equal(f.pushed.length, 0);
  assert.match(text(f.container), /Unknown consensus address/);
});
