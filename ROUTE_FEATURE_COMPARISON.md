# FIRMACHAIN Explorer 라우트 및 기능 비교

## 비교 범위와 읽는 방법

- 작성일: 2026-11-16
- 기준: `../firmachain-explorer`의 현재 소스. React Router의 `src/router.tsx`에 등록된 화면과 공통 기능을 기준으로 한다.
- 비교 대상: 현재 저장소 `explorer`. `vite.config.ts`의 파일 기반 라우트와 `src/modules`, `src/pages`의 구현을 확인했다.
- 이 문서는 **정적 소스 비교**다. 실제 배포 버전, 서버 데이터의 완전성, LCD/RPC 연결, 지갑 서명 및 전송 성공 여부는 검증하지 않았다. 데이터 소스와 노드 설정에 따라 결과가 달라질 수 있다.
- 상태의 **제공**은 대응 화면 또는 기능의 코드가 있다는 뜻이다. **부분 제공**은 대응 구현이 있지만 세부 기능이나 데이터 범위가 다르다는 뜻이다. **미확인**은 대응 구현을 확인하지 못했다는 뜻이며, 동작 불가능을 증명하는 것은 아니다.
- 아래 `/:chain`은 체인 이름이다. FIRMACHAIN 예시는 `/firmachain`이며, 같은 경로라도 mainnet/testnet 선택은 별도의 설정에 따른다. 기준 저장소의 URL과 비교 대상의 URL은 서로 호환되지 않는다.

## 요약

| 구분 | 비교 결과 |
| --- | --- |
| 핵심 탐색 화면 | 대시보드, 블록, 트랜잭션, 제안, 검증인, 계정, 파라미터에 대응 화면이 있다. 다만 경로와 데이터 표현은 다르다. |
| 이력 범위 | 기준의 블록·트랜잭션 목록은 GraphQL 페이지 추가 조회를 사용한다. 비교 대상의 해당 목록은 브라우저에서 수집한 최근 블록과 그 안의 트랜잭션 중심이다. |
| 주요 차이 | 기준의 제안 상세에는 예치자 목록과 투표 필터가 있다. 비교 대상은 투표·예치 실행 버튼은 있지만 별도의 예치자 목록은 화면에 표시하지 않는다. |
| 프로필 | 기준의 `/:dtag` Desmos 프로필 화면에 대응하는 비교 대상 화면은 확인하지 못했다. 기준의 FIRMACHAIN mainnet/testnet 설정도 프로필 기능을 비활성화한다. |
| 추가 기능 | 비교 대상에는 지갑 연결과 전송·위임·투표 등의 트랜잭션 실행 UI, IBC, 공급량, 가동률 등 기준 화면에 없는 기능이 있다. 실제 실행은 지갑·네트워크·체인 지원에 의존한다. |

## 기준 라우트별 비교

| 기준 라우트 | 기준 화면과 기능 | 비교 대상 대응 라우트 | 상태 및 차이 |
| --- | --- | --- | --- |
| `/` | 체인 대시보드: 체인·시장 지표, 토크노믹스, 합의 상태, 최근 블록과 트랜잭션 | `/:chain` | **부분 제공.** 체인 지표, 활성 제안, 지갑 자산·위임 정보, 앱/노드 버전 및 조건부 시장 정보를 제공한다. 기준의 합의·최근 블록·최근 트랜잭션 영역을 같은 화면에 그대로 재현하지는 않는다. 비교 대상의 `/`는 체인 목록·검색 화면이다. |
| `/blocks` | 블록 목록과 추가 이력 조회 | `/:chain/block` | **부분 제공.** 최근 블록과 트랜잭션 수 차트가 있다. 기준의 인덱싱된 목록 페이지 추가 조회 대신 최근 블록 캐시를 사용하며, 미래 블록 카운트다운 진입점이 추가되어 있다. |
| `/blocks/:height` | 블록 개요, 포함된 트랜잭션, 서명 정보 | `/:chain/block/:height` | **부분 제공.** 블록 ID·헤더·트랜잭션·마지막 커밋을 표시하고 이전/다음 블록으로 이동한다. 마지막 커밋은 동적 데이터 형태로 표시하므로 기준의 별도 서명 목록과 표현이 다르다. 미래 높이에는 예상 시간과 카운트다운을 표시한다. |
| `/transactions` | 트랜잭션 목록과 추가 이력 조회 | `/:chain/tx` | **부분 제공.** 최근 블록에서 수집한 트랜잭션 목록과 해시 검색 탭이 있다. 기준처럼 목록에서 전체 인덱싱 이력을 계속 불러오는 방식이 아니다. |
| `/transactions/:tx` | 트랜잭션 개요, 메시지 필터·원문 전환, 로그와 이벤트 | `/:chain/tx/:hash` | **부분 제공.** 상태·높이·시간·가스·수수료·메모, 메시지, 원본 JSON을 표시한다. 기준의 메시지 필터·원문 전환과 별도 로그/이벤트 UI에 대응하는 동일한 구성은 확인하지 못했다. 해시 검색도 화면 안에 있다. |
| `/proposals` | 거버넌스 제안 목록과 추가 조회 | `/:chain/gov` | **제공.** 투표 중·통과·거절 탭과 페이지 이동을 제공한다. 기준은 설정된 무시 목록의 제안을 제외하는 처리가 있다. |
| `/proposals/:id` | 제안 내용·일정, 집계 그래프, 투표자와 미투표자 필터, 예치자 목록 | `/:chain/gov/:proposal_id` | **부분 제공.** 내용·집계·일정·투표 목록과 페이지 이동이 있다. 예치 데이터를 가져오지만 별도의 예치자 목록은 렌더링하지 않으며, 기준의 미투표자·투표 선택별 목록 필터와 같은 UI는 확인하지 못했다. 대신 지갑 투표·예치 버튼, 조건부 업그레이드 카운트다운과 파라미터 비교가 있다. |
| `/validators` | 검증인 목록, 활성/비활성 구분, 이름·주소 검색, 정렬, 상태·투표권과 집중도 계산 | `/:chain/staking` | **부분 제공.** 활성·비활성·인기 탭, 투표권·수수료·jailed 상태 및 위임 버튼을 제공한다. 표시 지표와 정렬·집계 방식은 기준과 다르며, 기준의 모든 검색·집중도 기능과 동일한지 확인하지 못했다. |
| `/validators/:address` | 검증인 프로필·투표권, 블록·트랜잭션, 위임·재위임·언본딩 | `/:chain/staking/:validator` | **부분 제공.** 검증인 정보, 스테이킹 수치, 주소, 트랜잭션 및 위임/언본딩 이벤트와 위임·수수료 인출 동작이 있다. 기준의 블록 목록과 재위임·언본딩 탭에 대응하는 동일한 목록은 확인하지 못했다. 위임자 목록의 초기 조회는 주석 처리되어 있어 자동으로 채워진다고 볼 수 없다. |
| `/accounts/:address` | 계정 주소·출금 주소, 잔액·기타 토큰, 위임·재위임·언본딩 및 거래 | `/:chain/account/:address` | **부분 제공.** 자산·위임·언본딩, 보낸/받은 거래, 계정 원본 정보와 QR을 제공한다. 기준의 별도 재위임 이력 탭과 동일한 목록은 확인하지 못했다. 비교 대상에는 전송·IBC 전송·위임·재위임·언본딩·보상 인출 버튼이 추가로 있다. 재위임 **실행 버튼**과 재위임 **이력 목록**은 구분해야 한다. |
| `/params` | 스테이킹·슬래싱·발행·분배·거버넌스 파라미터 | `/:chain/params` | **부분 제공.** 같은 범주의 카드가 있으며 체인 ID, 애플리케이션·노드 정보도 표시한다. 단, 발행 파라미터는 카드가 있어도 페이지에서 조회하지 않고, 스토어의 초기 조회도 주석 처리되어 있다. `handleMintParam`도 응답을 카드에 할당하지 않는다. |
| `/:dtag` | Desmos 프로필과 연결 정보 | 대응 화면 미확인 | **미확인.** 기준에는 라우트와 화면 코드가 있으나 FIRMACHAIN mainnet/testnet 설정의 `extra.profile`은 `false`다. 비활성 상태에서는 해당 화면의 훅이 `/`로 리다이렉트한다. 비교 대상에 같은 프로필 화면은 확인하지 못했다. |
| `*` | 존재하지 않는 경로 처리 | 파일 기반 catch-all | **제공.** 비교 대상은 `src/pages/[...all].vue`에서 오류/coming-soon 화면과 홈 이동을 제공한다. 기준은 단일 경로 세그먼트가 `/:dtag`와 먼저 매칭될 수 있어 항상 404가 되는 것은 아니다. |

### 기존 URL 호환

기준 저장소는 `/account/:address` → `/accounts/:address`, `/validator/:address` → `/validators/:address`, `/transaction/:tx` → `/transactions/:tx` 리다이렉트를 명시한다. 비교 대상에는 체인 접두사를 추가하는 해당 리다이렉트를 확인하지 못했다. 따라서 기존 북마크나 외부 링크는 별도 라우팅/리다이렉트 설정 없이 호환된다고 가정하면 안 된다.

## 기능별 차이

### 공통 검색

- 기준: 블록 높이, 트랜잭션, 계정 주소, 검증인 운영자 주소, 합의 주소를 구분한다. 합의 주소는 검증인 매핑을 통해 이동한다. `@` 프로필 검색은 설정에서 프로필이 활성화된 경우에만 사용한다.
- 비교 대상: 숫자는 블록, 대문자 64자리 영숫자는 트랜잭션, Bech32 형식 주소는 계정 화면으로 보낸다. 공통 검색에서 검증인 주소를 별도 검증인 화면으로 분기하거나 `@` 프로필로 이동하는 구현은 확인하지 못했다. 트랜잭션 상세 화면의 해시 검색은 대소문자를 허용하고 대문자로 정규화한다.
- 근거: 기준 `src/components/nav/components/seach_bar/hooks.tsx`, 비교 대상 `src/layouts/components/NavbarSearch.vue`, `src/modules/[chain]/tx/[hash].vue`.

### 목록, 갱신과 데이터 소스

- 기준의 블록·트랜잭션 목록은 GraphQL query/subscription과 `fetchMore`를 사용한다. 제안 및 상세 데이터도 GraphQL 기반 조회가 중심이다. 설정에는 GraphQL HTTP/WebSocket과 REST/RPC 주소가 있다.
- 비교 대상은 Cosmos LCD/REST 및 RPC 설정을 사용한다. 블록 목록은 `useBaseStore`의 `recents`, 트랜잭션 목록은 그 블록들에서 만든 `txsInRecents`를 표시한다. 기본 최근 블록 보관 한도는 50이며 `VITE_RECENT_BLOCK_LIMIT`으로 조정한다. `VITE_FETCH_ALL_BLOCKS` 기본값이 `false`이면 갱신 사이의 중간 블록을 모두 가져오지 않는다. 따라서 목록이 체인의 전체 또는 연속 이력을 나타낸다고 볼 수 없다.
- 특정 과거 높이/해시 상세 조회는 목록에 해당 항목이 남아 있는지와 별개이며, 노드가 해당 데이터를 제공해야 한다.
- 근거: 기준 `src/graphql/blocks.graphql`, `transactions.graphql`, `src/screens/blocks/hooks.tsx`, `src/screens/transactions/hooks.ts`, `src/configs/env.ts`; 비교 대상 `src/stores/useBaseStore.ts`, `src/modules/[chain]/block/index.vue`, `src/modules/[chain]/tx/index.vue`, `README.md`.

### 지갑 및 트랜잭션 실행

비교 대상에는 계정·검증인·제안 화면에서 지갑을 통한 전송, IBC 전송, 위임, 재위임, 언본딩, 보상 인출, 투표 및 예치 대화상자를 여는 코드가 있다. 기준의 위 대응 화면은 조회 중심이다. 버튼이나 대화상자의 존재는 서명·브로드캐스트 성공을 뜻하지 않으며, 연결된 지갑과 체인·노드의 지원이 필요하다.

근거: 비교 대상 `src/modules/[chain]/account/[address].vue`, `staking/[validator].vue`, `gov/[proposal_id].vue`, `src/layouts/components/NavBarWallet.vue`.

### 네트워크, 메뉴와 시장 정보

- 기준은 `chain_config.mainnet.json`, `chain_config.testnet.json`과 환경 설정을 사용한다. 비교 대상은 `chains/mainnet/firmachain.json`, `chains/testnet/firmachain.json`을 제공하며, `VITE_NETWORK` 또는 호스트 이름으로 네트워크를 선택하고 `VITE_CHAIN`으로 체인을 제한할 수 있다.
- 기준의 네트워크 선택기는 다른 네트워크의 설정된 익스플로러를 새 탭으로 연다. 현재 화면의 GraphQL 연결을 즉시 전환하는 방식은 아니다. 비교 대상의 체인 경로 선택과는 구분해야 한다.
- 비교 대상의 체인 메뉴는 라우트의 `meta.i18n`과 체인 설정의 `features`를 함께 사용한다. `features`에 항목이 있다는 것만으로 메뉴가 생기는 것은 아니며, 메뉴에 없다는 것만으로 해당 라우트가 등록되지 않았다는 뜻도 아니다. 라우터에서 동일한 기능 접근 차단은 확인하지 못했다.
- 비교 대상의 시장 정보는 CoinGecko 식별자와 응답에 의존한다. FIRMACHAIN mainnet 설정에는 식별자가 있지만 testnet 설정에는 없다. testnet에서 시장 정보를 mainnet과 동일하게 기대하면 안 된다.
- 기준 설정 화면에는 테마, 언어, 날짜 형식, 트랜잭션 목록 형식이 있다. 비교 대상에도 테마·언어 선택 UI가 있지만 기준의 모든 설정과 동일한 옵션이나 저장 동작을 제공하는지는 확인하지 못했다.
- 근거: 기준 `src/components/nav/components/desktop/components/action_bar/components/network/index.tsx`, `setting_list/index.tsx`; 비교 대상 `src/stores/useDashboard.ts`, `src/stores/useBlockchain.ts`, `src/modules/[chain]/indexStore.ts`, 두 FIRMACHAIN 체인 설정.

## 비교 대상에 추가로 존재하는 페이지

아래는 기준 라우터에 직접 대응하는 페이지가 없는 비교 대상의 파일 기반 라우트다. 파일의 존재는 실제 데이터 제공이나 기능 완성을 보장하지 않는다.

| 경로 | 용도 또는 주의 사항 |
| --- | --- |
| `/` | 체인 목록과 검색. 기준의 `/` 체인 대시보드와 다름 |
| `/:chain/account` | 계정 목록. 사이드바 자동 메뉴에 필요한 `meta.i18n`은 이 파일에 없다 |
| `/:chain/consensus`, `/:chain/uptime`, `/:chain/uptime/customize` | 합의 및 검증인 가동률 관련 화면 |
| `/:chain/ibc/connection`, `/:chain/ibc/connection/:connection_id` | IBC 연결 목록과 상세 |
| `/:chain/supply` | 토큰 공급량 |
| `/:chain/cosmwasm`, `/:chain/cosmwasm/:code_id/contracts`, `/:chain/cosmwasm/:code_id/transactions` | CosmWasm 코드·컨트랙트 관련 화면. FIRMACHAIN의 기본 `features`에는 `cosmwasm`이 없다 |
| `/:chain/statesync`, `/:chain/widget` | 상태 동기화 및 위젯 화면. FIRMACHAIN의 기본 `features`에는 없다 |
| `/:chain/faucet` | 테스트넷 등에서 사용하는 faucet 화면. 실제 사용은 faucet 설정과 서비스에 의존 |
| `/:chain/group`, `/:chain/nft` | 라우트 파일은 있으나 기능 완성을 전제로 하면 안 된다. 특히 NFT 화면은 현재 `NFT` 텍스트만 표시한다 |
| `/wallet/accounts`, `/wallet/keplr`, `/wallet/portfolio`, `/wallet/receive`, `/wallet/suggest`, `/wallet/unisat` | 체인 경로 밖의 지갑 관련 화면. 실제 공급자 지원과 동작은 별도 검증 필요 |

## 주요 근거 파일

| 영역 | 기준 `../firmachain-explorer` | 비교 대상 `explorer` |
| --- | --- | --- |
| 라우트 | `src/router.tsx` | `vite.config.ts`, `src/router/index.ts`, `src/pages`, `src/modules` |
| 대시보드 | `src/screens/home` | `src/modules/[chain]/index.vue`, `indexStore.ts` |
| 블록·거래 | `src/screens/blocks`, `block_details`, `transactions`, `transaction_details`, `src/graphql` | `src/modules/[chain]/block`, `tx`, `src/stores/useBaseStore.ts` |
| 거버넌스 | `src/screens/proposals`, `proposal_details` | `src/modules/[chain]/gov` |
| 검증인·계정 | `src/screens/validators`, `validator_details`, `account_details` | `src/modules/[chain]/staking`, `account` |
| 파라미터·프로필 | `src/screens/params`, `profile_details`, `src/configs/chain_config.*.json` | `src/modules/[chain]/params`, `chains/*/firmachain.json` |
| 공통 메뉴·검색 | `src/components/nav/components/menu_items`, `seach_bar` | `src/layouts/components`, `src/stores/useBlockchain.ts` |
