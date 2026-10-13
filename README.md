# Masterpack · SAP FI 프로젝트

SAP CODE 1기 교육 프로젝트의 FI 중심 ABAP 프로그램과 SAPUI5/Fiori 애플리케이션을 모았습니다. QM 관련 프로그램도 함께 포함되어 있습니다.

[프로젝트 소개 및 구현 화면](https://sherlock0105.github.io/project.html) · [SAP 포트폴리오](https://sherlock0105.github.io/)

## 저장소 구성

| 폴더 | 기능 설명 | 구분 |
| --- | --- | --- |
| [`ze3_fi_asset/`](ze3_fi_asset/) | 고정자산 조회 | UI5 화면 |
| [`ze3_fi_bpmaster/`](ze3_fi_bpmaster/) | 고객·공급업체 마스터 관리 | UI5 화면 |
| [`ze3_fi_employee/`](ze3_fi_employee/) | 사원 정보 등록 및 급여 지급 | UI5 화면 |
| [`ze3_fi_financial/`](ze3_fi_financial/) | 재무제표 조회 | UI5 화면 |
| [`ze3_fi_hbk_rate/`](ze3_fi_hbk_rate/) | 외화통장 보유액 조회 및 환율 평가 | UI5 화면 |
| [`ze3_fi_post_search/`](ze3_fi_post_search/) | 전표 조회 | UI5 화면 |
| [`ze3_qm_display/`](ze3_qm_display/) | 완제품 폐기 현황 | UI5 화면 |
| [`ze3_qm_insp/`](ze3_qm_insp/) | 완제품 품질 검사 | UI5 화면 |
| [`ze3fi0002/`](ze3fi0002/) | 외화평가 및 환손익 분석 | ABAP 프로그램 |
| [`ze3qm0001/`](ze3qm0001/) | 완제품 품질 검수 | ABAP 프로그램 |
| [`zre3fi0001/`](zre3fi0001/) | 환율 API 수신 | ABAP 프로그램 |
| [`zre3fi0003/`](zre3fi0003/) | 전표 조회 및 역분개 | ABAP 프로그램 |
| [`zre3fi0007/`](zre3fi0007/) | 감가상각 자동 처리 (배치) | ABAP 프로그램 |
| [`zre3fi0008/`](zre3fi0008/) | 자산 관리 및 감가상각 | ABAP 프로그램 |
| [`zre3fi0009/`](zre3fi0009/) | 외화평가 자동 처리 (배치) | ABAP 프로그램 |
| [`zre3fi0010/`](zre3fi0010/) | 재무상태표 | ABAP 프로그램 |

전표 조회 및 역분개는 **[zre3fi0003/](zre3fi0003/)** 폴더입니다. 역분개는 기존 전표의 회계 처리를 취소하기 위해 반대 내용의 전표를 만드는 기능입니다.

## 코드 살펴보기

UI5 앱은 각 폴더의 `webapp/controller/`, `webapp/view/`, `webapp/manifest.json`에서 화면 로직과 서비스 연결을 확인할 수 있습니다. ABAP 폴더의 HTML 파일은 소스 열람용으로 내보낸 자료이며, `screens/`에는 화면 정의가 있습니다.

## 로컬 실행 예시

Node.js와 npm을 준비한 후 재무상태표 앱 폴더에서 실행합니다.

```bash
cd ze3_fi_financial
npm install
npm run start-mock
```

이 명령은 해당 앱에 정의된 모의 서비스 실행 방식입니다. 실제 업무 데이터 조회에는 SAP 백엔드와 앱별 서비스 설정이 필요하며, 모의 데이터의 범위는 앱마다 다릅니다. ABAP 프로그램은 관련 DDIC 객체와 화면이 구성된 SAP 개발 환경에서 실행합니다.

## 관련 저장소

- [SAPUI5 / Fiori 학습 모음](https://github.com/sherlock0105/ui5_fiori)
- [ABAP 학습 모음](https://github.com/sherlock0105/ABAP-STUDY)
