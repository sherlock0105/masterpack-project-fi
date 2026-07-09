sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox,
  ) {
    "use strict";

    var EMPTY_FORM = {
      Bpcode: "",
      Bptype: "C",
      Bpname: "",
      Countrycode: "",
      Bizregno: "",
      Telno: "",
      Address: "",
      Parvw: "",
      Paymentterm: "",
      Bankaccount: "",
      Bankname: "",
      Bankown: "",
      Useflag: "Y",
      Email: "",
      Repname: "",
    };

    // 공급업체 국가별 번호 범위
    var VENDOR_RANGES = {
      KR: { start: 1, end: 99 },
      JP: { start: 101, end: 199 },
      EU: { start: 201, end: 299 },
      US: { start: 301, end: 399 },
    };

    var COUNTRIES = [
      { code: "KR", name: "대한민국 (Korea)" },
      { code: "JP", name: "일본 (Japan)" },
      { code: "US", name: "미국 (USA)" },
      { code: "EU", name: "유럽 (Europe)" },
      { code: "CN", name: "중국 (China)" },
      { code: "DE", name: "독일 (Germany)" },
      { code: "FR", name: "프랑스 (France)" },
      { code: "GB", name: "영국 (UK)" },
      { code: "SG", name: "싱가포르 (Singapore)" },
      { code: "AU", name: "호주 (Australia)" },
      { code: "IN", name: "인도 (India)" },
      { code: "TH", name: "태국 (Thailand)" },
      { code: "VN", name: "베트남 (Vietnam)" },
    ];

    // 고객: 30일, 60일 / 공급업체: 30일, 45일, 60일
    var PAYMENT_TERMS_C = [
      { code: "30일", name: "30일" },
      { code: "60일", name: "60일" },
    ];
    var PAYMENT_TERMS_V = [
      { code: "30일", name: "30일" },
      { code: "45일", name: "45일" },
      { code: "60일", name: "60일" },
    ];

    // 필수 필드 정의 (Label text, form key)
    var REQUIRED_FIELDS = [
      { key: "Bptype", label: "BP 유형" },
      { key: "Countrycode", label: "국가 코드" },
      { key: "Bpcode", label: "BP 코드" },
      { key: "Bpname", label: "BP 명칭" },
      { key: "Bizregno", label: "사업자 번호" },
      { key: "Repname", label: "대표자명" },
      { key: "Telno", label: "전화번호" },
      { key: "Email", label: "이메일" },
      { key: "Address", label: "주소" },
      { key: "Paymentterm", label: "결제 조건" },
      { key: "Bankname", label: "은행명" },
      { key: "Bankaccount", label: "계좌번호" },
      { key: "Bankown", label: "예금주" },
    ];

    return Controller.extend(
      "ze3.fi.bpmaster.ze3fibpmaster.controller.BpMasterView",
      {
        onInit: function () {
          this.getView().setModel(
            new JSONModel({
              mode: "READ",
              selectedType: "",
              selectedUseflag: "",
              listBusy: false,
              listItems: [],
              listCount: 0,
              allItems: [],
              kpi: { total: "-", customer: "-", vendor: "-" },
              form: Object.assign({}, EMPTY_FORM),
              _backup: null,
              countries: COUNTRIES,
              paymentTerms: PAYMENT_TERMS_C,
              useflagOptions: [
                { key: "Y", text: "활성 (Y)" },
                { key: "N", text: "비활성 (N)" },
              ],
              filteredItems: [],
              pagination: {
                currentPage: 1,
                totalPages: 1,
                pageSize: 15,
                pages: [],
                pageInfo: "0 건",
              },
            }),
            "view",
          );

          this.getOwnerComponent()
            .getModel()
            .metadataLoaded()
            .then(
              function () {
                this._loadAll();
              }.bind(this),
            );
        },

        // ── 전체 목록 로드 (KPI 포함) ─────────────────────────────
        _loadAll: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/listBusy", true);

          this.getOwnerComponent()
            .getModel()
            .read("/BpMasterSet", {
              success: function (oData) {
                var aAll = oData.results || [];
                aAll.forEach(function (r) {
                  r.Useflag = (r.Useflag || "").trim().toUpperCase();
                });
                var nC = aAll.filter(function (r) {
                  return r.Bptype === "C";
                }).length;
                var nV = aAll.filter(function (r) {
                  return r.Bptype === "V";
                }).length;

                oVM.setProperty("/allItems", aAll);
                oVM.setProperty("/kpi", {
                  total: String(aAll.length),
                  customer: String(nC),
                  vendor: String(nV),
                });
                oVM.setProperty("/listBusy", false);
                this._applyFilter();
                this._buildCountryChart(aAll);
              }.bind(this),
              error: function (oErr) {
                oVM.setProperty("/listBusy", false);
                this._showError("목록 조회 오류", oErr);
              }.bind(this),
            });
        },

        // ── 국가별 분포 도넛 차트 ─────────────────────────────────
        _buildCountryChart: function (aAll) {
          var oViz = this.byId("idCountryChart");
          if (!oViz) return;

          var mCountry = {};
          (aAll || []).forEach(function (r) {
            var c = (r.Countrycode || "").trim() || "(없음)";
            mCountry[c] = (mCountry[c] || 0) + 1;
          });

          var aData = Object.keys(mCountry)
            .map(function (k) { return { Country: k, Count: mCountry[k] }; })
            .sort(function (a, b) { return b.Count - a.Count; });

          if (aData.length > 6) {
            var nOthers = aData.slice(6).reduce(function (s, d) { return s + d.Count; }, 0);
            aData = aData.slice(0, 6);
            aData.push({ Country: "기타", Count: nOthers });
          }

          sap.ui.require(
            [
              "sap/viz/ui5/data/FlattenedDataset",
              "sap/viz/ui5/controls/common/feeds/FeedItem",
            ],
            function (FlattenedDataset, FeedItem) {
              var oModel = this.getView().getModel("view");
              oViz.setModel(new oModel.constructor({ data: aData }));
              oViz.setDataset(
                new FlattenedDataset({
                  dimensions: [{ name: "국가", value: "{Country}" }],
                  measures:   [{ name: "건수", value: "{Count}" }],
                  data:       { path: "/data" },
                }),
              );
              oViz.removeAllFeeds();
              oViz.addFeed(new FeedItem({ uid: "size",  type: "Measure",   values: ["건수"] }));
              oViz.addFeed(new FeedItem({ uid: "color", type: "Dimension", values: ["국가"] }));
              oViz.setVizProperties({
                title:    { visible: false },
                legend:   { visible: true, position: "right" },
                plotArea: { dataLabel: { visible: false } },
              });
            }.bind(this),
          );
        },

        // ── 로컬 필터 적용 (BP코드 / BP명 / 국가코드 모두 검색) ────
        _applyFilter: function () {
          var oVM = this.getView().getModel("view");
          var sType = oVM.getProperty("/selectedType");
          var oSearch = this.byId("searchField");
          var sSearch = (oSearch ? oSearch.getValue() : "")
            .trim()
            .toLowerCase();
          var aAll = oVM.getProperty("/allItems") || [];

          var sUseflag = oVM.getProperty("/selectedUseflag");

          var aFiltered = aAll.filter(function (r) {
            var bType = !sType || r.Bptype === sType;
            var isActive = r.Useflag === "Y" || r.Useflag === "A";
            var bUseflag =
              !sUseflag ||
              (sUseflag === "Y" && isActive) ||
              (sUseflag === "N" && !isActive);
            var bSearch =
              !sSearch ||
              (r.Bpcode || "").toLowerCase().indexOf(sSearch) >= 0 ||
              (r.Bpname || "").toLowerCase().indexOf(sSearch) >= 0 ||
              (r.Countrycode || "").toLowerCase().indexOf(sSearch) >= 0 ||
              (r.Bizregno || "").toLowerCase().indexOf(sSearch) >= 0 ||
              (r.Email || "").toLowerCase().indexOf(sSearch) >= 0;
            return bType && bUseflag && bSearch;
          });

          oVM.setProperty("/filteredItems", aFiltered);
          oVM.setProperty("/listCount", aFiltered.length);
          this._goToPage(1, aFiltered);
        },

        // ── 페이지 이동 ───────────────────────────────────────────
        _goToPage: function (nPage, aFiltered) {
          var oVM = this.getView().getModel("view");
          aFiltered = aFiltered || oVM.getProperty("/filteredItems") || [];
          var nSize = 15;
          var nTotal = aFiltered.length;
          var nPages = Math.max(1, Math.ceil(nTotal / nSize));
          nPage = Math.max(1, Math.min(nPage, nPages));
          var nStart = (nPage - 1) * nSize;
          var nEnd = Math.min(nStart + nSize, nTotal);
          var sInfo =
            nTotal === 0
              ? "0 건"
              : nStart + 1 + " - " + nEnd + " / " + nTotal + " 건";

          oVM.setProperty("/listItems", aFiltered.slice(nStart, nEnd));
          oVM.setProperty("/pagination/currentPage", nPage);
          oVM.setProperty("/pagination/totalPages", nPages);
          oVM.setProperty("/pagination/pageInfo", sInfo);
          oVM.setProperty("/pagination/pages", this._buildPages(nPage, nPages));
        },

        // ── 페이지 버튼 배열 생성 ─────────────────────────────────
        _buildPages: function (nCurrent, nTotal) {
          var aPages = [];

          if (nTotal <= 10) {
            for (var i = 1; i <= nTotal; i++) {
              aPages.push({
                num: String(i),
                active: i === nCurrent,
                enabled: true,
              });
            }
            return aPages;
          }

          // 슬라이딩 윈도우: 1 ... prev cur next ... last
          var aShow = [1];
          if (nCurrent - 1 > 2) {
            aShow.push(-1);
          }
          for (
            var j = Math.max(2, nCurrent - 1);
            j <= Math.min(nTotal - 1, nCurrent + 1);
            j++
          ) {
            aShow.push(j);
          }
          if (nCurrent + 1 < nTotal - 1) {
            aShow.push(-1);
          }
          if (nTotal > 1) {
            aShow.push(nTotal);
          }

          aShow.forEach(function (n) {
            if (n === -1) {
              aPages.push({ num: "···", active: false, enabled: false });
            } else {
              aPages.push({
                num: String(n),
                active: n === nCurrent,
                enabled: true,
              });
            }
          });
          return aPages;
        },

        // ── 페이지 이벤트 핸들러 ──────────────────────────────────
        onPagePress: function (oEvent) {
          var sNum = oEvent.getSource().getText();
          var nPage = parseInt(sNum, 10);
          if (!isNaN(nPage)) {
            this._goToPage(nPage);
          }
        },

        onPrevPage: function () {
          var oVM = this.getView().getModel("view");
          this._goToPage(oVM.getProperty("/pagination/currentPage") - 1);
        },

        onNextPage: function () {
          var oVM = this.getView().getModel("view");
          this._goToPage(oVM.getProperty("/pagination/currentPage") + 1);
        },

        // ── 유형 탭 변경 ──────────────────────────────────────────
        onTypeChange: function () {
          this._applyFilter();
        },

        // ── 활성 상태 탭 변경 ─────────────────────────────────────
        onUseflagChange: function () {
          this._applyFilter();
        },

        // ── 검색 ──────────────────────────────────────────────────
        onSearch: function () {
          this._applyFilter();
        },

        // ── 행 클릭 → 단건 조회 → 다이얼로그 ─────────────────────
        onRowPress: function (oEvent) {
          var oItem = oEvent.getSource().getBindingContext("view").getObject();
          this._readOne(oItem.Bpcode, oItem.Bptype);
        },

        _readOne: function (sBpcode, sBptype) {
          var oVM = this.getView().getModel("view");
          var oModel = this.getOwnerComponent().getModel();
          var sKey = oModel.createKey("BpMasterSet", {
            Bpcode: sBpcode,
            Bptype: sBptype,
          });

          oModel.read("/" + sKey, {
            success: function (oData) {
              var oForm = Object.assign({}, oData);
              if (oForm.Useflag) {
                oForm.Useflag = oForm.Useflag.trim().toUpperCase();
              }
              oVM.setProperty("/form", oForm);
              this._syncUseflagOptions(oForm.Bptype);
              this._setMode("READ");
              this._openDialog();
            }.bind(this),
            error: function (oErr) {
              this._showError("단건 조회 오류", oErr);
            }.bind(this),
          });
        },

        // ── 생성 버튼 ──────────────────────────────────────────────
        onNewCreate: function () {
          var sType =
            this.getView().getModel("view").getProperty("/selectedType") || "C";
          this.getView()
            .getModel("view")
            .setProperty(
              "/form",
              Object.assign({}, EMPTY_FORM, {
                Bptype: sType,
                Useflag: sType === "V" ? "A" : "Y",
              }),
            );
          this._syncPaymentTerms(sType);
          this._syncUseflagOptions(sType);
          this._setMode("CREATE");
          this._openDialog();
        },

        // ── BP 유형 변경 시 코드/결제조건/활성상태 초기화 + 재생성 ──
        onBptypeChange: function (oEvent) {
          var oVM = this.getView().getModel("view");
          var sType = oEvent.getSource().getSelectedKey();

          oVM.setProperty("/form/Bpcode", "");
          oVM.setProperty("/form/Paymentterm", "");
          oVM.setProperty("/form/Useflag", sType === "V" ? "A" : "Y");
          this._syncPaymentTerms(sType);
          this._syncUseflagOptions(sType);

          var sCountry = oVM.getProperty("/form/Countrycode");
          if (sCountry) {
            this._generateBpCode(sCountry, sType);
          }
        },

        // 유형에 맞는 결제조건 목록 동기화
        _syncPaymentTerms: function (sBptype) {
          this.getView()
            .getModel("view")
            .setProperty(
              "/paymentTerms",
              sBptype === "V" ? PAYMENT_TERMS_V : PAYMENT_TERMS_C,
            );
        },

        // 유형에 맞는 활성 상태 옵션 동기화 (고객: Y/N, 공급업체: A/B)
        _syncUseflagOptions: function (sBptype) {
          this.getView()
            .getModel("view")
            .setProperty(
              "/useflagOptions",
              sBptype === "V"
                ? [
                    { key: "A", text: "활성" },
                    { key: "B", text: "비활성" },
                  ]
                : [
                    { key: "Y", text: "활성" },
                    { key: "N", text: "비활성" },
                  ],
            );
        },

        // ── BP 검색 서치헬프 ──────────────────────────────────────
        onBpSearchValueHelp: function () {
          this.byId("bpSearchDialog").open();
        },

        onBpSearchDialogSearch: function (oEvent) {
          var sTerm = (oEvent.getParameter("value") || "").toLowerCase();
          var oBinding = this.byId("bpSearchDialog").getBinding("items");
          if (!sTerm) {
            oBinding.filter([]);
            return;
          }
          oBinding.filter([
            new Filter(
              [
                new Filter(
                  "Bpcode",
                  FilterOperator.Contains,
                  sTerm.toUpperCase(),
                ),
                new Filter("Bpname", function (v) {
                  return v && v.toLowerCase().indexOf(sTerm) >= 0;
                }),
              ],
              false,
            ),
          ]);
        },

        onBpSearchDialogConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");
          if (oSelected) {
            var oItem = oSelected.getBindingContext("view").getObject();
            this.byId("searchField").setValue(oItem.Bpcode);
          }
          this.byId("bpSearchDialog").getBinding("items").filter([]);
          this._applyFilter();
        },

        // ── 국가 서치헬프 ─────────────────────────────────────────
        onCountryValueHelp: function () {
          this.getView().getModel("view").setProperty("/countries", COUNTRIES);
          this.byId("countryDialog").open();
        },

        onCountryDialogSearch: function (oEvent) {
          var sTerm = (oEvent.getParameter("value") || "").toLowerCase();
          var oBinding = this.byId("countryDialog").getBinding("items");

          if (!sTerm) {
            oBinding.filter([]);
            return;
          }
          oBinding.filter([
            new Filter(
              [
                new Filter(
                  "code",
                  FilterOperator.Contains,
                  sTerm.toUpperCase(),
                ),
                new Filter("name", function (sVal) {
                  return sVal && sVal.toLowerCase().indexOf(sTerm) >= 0;
                }),
              ],
              false,
            ),
          ]);
        },

        onCountryDialogConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");
          if (!oSelected) return;

          var oVM = this.getView().getModel("view");
          var sCode = oSelected.getTitle();
          var sType = oVM.getProperty("/form/Bptype");

          oVM.setProperty("/form/Countrycode", sCode);
          this._generateBpCode(sCode, sType);
        },

        // ── 결제 조건 서치헬프 (유형별 목록) ─────────────────────
        onPaymentTermValueHelp: function () {
          var sType = this.getView()
            .getModel("view")
            .getProperty("/form/Bptype");
          this._syncPaymentTerms(sType);
          this.byId("paymentTermDialog").open();
        },

        onPaymentTermDialogConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");
          if (!oSelected) return;
          var oCtx = oSelected.getBindingContext("view");
          this.getView()
            .getModel("view")
            .setProperty(
              "/form/Paymentterm",
              oCtx ? oCtx.getObject().code : oSelected.getTitle(),
            );
        },

        // ── BP 코드 자동 생성 ─────────────────────────────────────
        _generateBpCode: function (sCountry, sBptype) {
          if (!sCountry) return;

          var oVM = this.getView().getModel("view");
          var aAll = oVM.getProperty("/allItems") || [];

          if (sBptype === "V") {
            // 공급업체: V001(KR) / V101(JP) / V201(EU) / V301(US)
            var oRange = VENDOR_RANGES[sCountry];
            if (!oRange) {
              MessageToast.show(
                "국가 [" +
                  sCountry +
                  "]의 번호 범위가 미정의입니다. BP코드를 직접 수정하세요.",
              );
              return;
            }

            var aUsed = aAll
              .filter(function (r) {
                return r.Bptype === "V" && /^V\d+$/.test(r.Bpcode);
              })
              .map(function (r) {
                return parseInt(r.Bpcode.substring(1), 10);
              })
              .filter(function (n) {
                return n >= oRange.start && n <= oRange.end;
              });

            var nMax = aUsed.length
              ? Math.max.apply(null, aUsed)
              : oRange.start - 1;
            var nNext = nMax + 1;

            if (nNext > oRange.end) {
              MessageBox.warning(
                "국가 [" +
                  sCountry +
                  "] 공급업체 코드 범위(" +
                  oRange.start +
                  "~" +
                  oRange.end +
                  ")가 가득 찼습니다.",
              );
              return;
            }
            oVM.setProperty(
              "/form/Bpcode",
              "V" + String(nNext).padStart(3, "0"),
            );
          } else {
            // 고객: KR0001 / JP0001 / EU0001 / US0001
            var sPrefix = sCountry;

            var aUsed2 = aAll
              .filter(function (r) {
                return r.Bptype === "C" && r.Bpcode.indexOf(sPrefix) === 0;
              })
              .map(function (r) {
                return parseInt(r.Bpcode.substring(sPrefix.length), 10);
              })
              .filter(function (n) {
                return !isNaN(n);
              });

            var nMax2 = aUsed2.length ? Math.max.apply(null, aUsed2) : 0;
            var nNext2 = nMax2 + 1;

            oVM.setProperty(
              "/form/Bpcode",
              sPrefix + String(nNext2).padStart(4, "0"),
            );
          }
        },

        // ── 수정 모드 전환 ─────────────────────────────────────────
        onEdit: function () {
          var oVM = this.getView().getModel("view");
          var sType = oVM.getProperty("/form/Bptype");
          oVM.setProperty(
            "/_backup",
            Object.assign({}, oVM.getProperty("/form")),
          );
          this._syncPaymentTerms(sType);
          this._syncUseflagOptions(sType);
          this._setMode("EDIT");
        },

        // ── 저장 (CREATE / UPDATE 분기) ────────────────────────────
        onSave: function () {
          var oVM = this.getView().getModel("view");
          var sMode = oVM.getProperty("/mode");
          var oForm = oVM.getProperty("/form");

          // 필수 필드 전체 검증
          var aMissing = REQUIRED_FIELDS.filter(function (f) {
            return !oForm[f.key] || oForm[f.key].trim() === "";
          });
          // 고객(C)일 때만 배송지 주소 필수
          if (
            oForm.Bptype === "C" &&
            (!oForm.Parvw || oForm.Parvw.trim() === "")
          ) {
            aMissing.push({ label: "배송지 주소" });
          }
          if (aMissing.length) {
            MessageBox.warning(
              "아래 필드를 입력해주세요:\n" +
                aMissing
                  .map(function (f) {
                    return "  · " + f.label;
                  })
                  .join("\n"),
            );
            return;
          }

          if (sMode === "CREATE") {
            this._create(oForm);
          } else {
            this._update(oForm);
          }
        },

        _create: function (oForm) {
          this.getOwnerComponent()
            .getModel()
            .create("/BpMasterSet", oForm, {
              success: function () {
                MessageToast.show("저장되었습니다.");
                this._closeDialog();
                this._loadAll();
              }.bind(this),
              error: function (oErr) {
                this._showError("생성 오류", oErr);
              }.bind(this),
            });
        },

        _update: function (oForm) {
          var oVM = this.getView().getModel("view");
          var oModel = this.getOwnerComponent().getModel();
          var sKey = oModel.createKey("BpMasterSet", {
            Bpcode: oForm.Bpcode,
            Bptype: oForm.Bptype,
          });

          oModel.update("/" + sKey, oForm, {
            success: function () {
              MessageToast.show("수정되었습니다.");
              oVM.setProperty("/form", Object.assign({}, oForm));

              // 로컬 allItems 즉시 반영
              var aAll = oVM.getProperty("/allItems") || [];
              aAll.forEach(function (r) {
                if (r.Bpcode === oForm.Bpcode && r.Bptype === oForm.Bptype) {
                  Object.assign(r, oForm);
                }
              });
              oVM.setProperty("/allItems", aAll);

              this._setMode("READ");
              this._applyFilter();
              this._loadAll();
            }.bind(this),
            error: function (oErr) {
              this._showError("수정 오류", oErr);
            }.bind(this),
          });
        },

        // ── 비활성화 ────────────────────────────────────────────────
        onDeactivate: function () {
          var oForm = this.getView().getModel("view").getProperty("/form");
          MessageBox.confirm(
            "BP [" +
              oForm.Bpcode +
              "] " +
              oForm.Bpname +
              " 을(를) 비활성화하시겠습니까?\n비활성화된 BP는 거래에 사용할 수 없으며, 수정 후 재활성화할 수 있습니다.",
            {
              title: "비활성화 확인",
              onClose: function (sAction) {
                if (sAction === MessageBox.Action.OK) {
                  this._deactivate(oForm);
                }
              }.bind(this),
            },
          );
        },

        _deactivate: function (oForm) {
          var oVM = this.getView().getModel("view");
          var oModel = this.getOwnerComponent().getModel();
          var sKey = oModel.createKey("BpMasterSet", {
            Bpcode: oForm.Bpcode,
            Bptype: oForm.Bptype,
          });
          var sInactiveFlag = oForm.Bptype === "V" ? "B" : "N";
          var oPayload = Object.assign({}, oForm, { Useflag: sInactiveFlag });

          oModel.update("/" + sKey, oPayload, {
            success: function () {
              MessageToast.show("비활성화되었습니다.");

              // 로컬 allItems 즉시 반영 (비동기 _loadAll 전에 필터가 동작하도록)
              var aAll = oVM.getProperty("/allItems") || [];
              aAll.forEach(function (r) {
                if (r.Bpcode === oForm.Bpcode && r.Bptype === oForm.Bptype) {
                  r.Useflag = sInactiveFlag;
                }
              });
              oVM.setProperty("/allItems", aAll);

              oVM.setProperty("/form/Useflag", sInactiveFlag);
              this._setMode("READ");
              this._applyFilter();
              this._loadAll();
              this._closeDialog();
            }.bind(this),
            error: function (oErr) {
              this._showError("비활성화 오류", oErr);
            }.bind(this),
          });
        },

        // ── 취소 ───────────────────────────────────────────────────
        onCancel: function () {
          var oVM = this.getView().getModel("view");
          var sMode = oVM.getProperty("/mode");

          if (sMode === "CREATE") {
            this._closeDialog();
          } else {
            var oBackup = oVM.getProperty("/_backup");
            if (oBackup) {
              oVM.setProperty("/form", Object.assign({}, oBackup));
            }
            this._setMode("READ");
          }
        },

        onCloseDialog: function () {
          this._closeDialog();
        },

        // ── 헬퍼 ───────────────────────────────────────────────────
        _setMode: function (sMode) {
          this.getView().getModel("view").setProperty("/mode", sMode);
        },

        _openDialog: function () {
          this.byId("detailDialog").open();
        },

        _closeDialog: function () {
          this.byId("detailDialog").close();
        },

        _showError: function (sTitle, oErr) {
          var sMsg = oErr.message || "";
          try {
            sMsg = JSON.parse(oErr.responseText).error.message.value;
          } catch (e) {}
          MessageBox.error(sTitle + ": " + sMsg);
        },
      },
    );
  },
);
