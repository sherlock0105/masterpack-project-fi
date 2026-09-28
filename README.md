# Masterpack · SAP FI 프로젝트

SAP CODE 1기 교육 프로젝트의 FI 중심 ABAP 프로그램과 SAPUI5/Fiori 애플리케이션을 모았습니다. QM 관련 프로그램도 함께 포함되어 있습니다.

[프로젝트 소개 및 구현 화면](https://sherlock0105.github.io/project.html) · [SAP 포트폴리오](https://sherlock0105.github.io/)

## 저장소 구성

| 경로 | 내용 |
| --- | --- |
| `ze3_fi_asset/` | 자산 관련 UI5 앱 |
| `ze3_fi_bpmaster/` | 거래처 관련 UI5 앱 |
| `ze3_fi_employee/` | 사원 관련 UI5 앱 |
| `ze3_fi_financial/` | 재무상태표 UI5 앱 |
| `ze3_fi_hbk_rate/` | 환율 관련 UI5 앱 |
| `ze3_fi_post_search/` | 전표 조회 UI5 앱 |
| `ze3_qm_display/`, `ze3_qm_insp/` | QM 관련 UI5 앱 |
| `ze3fi0002/`, `ze3qm0001/`, `zre3fi*/` | ABAP 프로그램, Include, 화면 및 관련 사전 객체 자료 |

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
