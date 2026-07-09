sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
  ],
  function (Controller, JSONModel, MessageToast, MessageBox, Fragment) {
    "use strict";

    var BTRTL = {
      MGMT: "경영기획실",
      SD_DOM: "국내영업",
      SD_GLO: "해외영업",
      MKTG: "마케팅",
      RND: "연구개발",
      PP_PLT: "생산(공장)",
      QM_QC: "품질관리",
      QM_QA: "품질보증",
      MM_PUR: "구매팀",
      MM_LOG: "물류팀",
      PLAN: "경영기획팀",
      HR: "인사팀",
      FIN: "재무팀",
      ACCT: "회계팀",
    };
    var GRADE = {
      SA: "사원",
      DR: "대리",
      GJ: "과장",
      BJ: "부장",
      DI: "이사",
      IM: "대표",
    };

    var GRADE_SALARY = {
      SA: "2800000",
      DR: "3500000",
      GJ: "4500000",
      BJ: "6000000",
      DI: "6000000",
      IM: "7000000",
    };

    var KOSTL_MAP = {
      MGMT: "CC_MGMT",
      SD_DOM: "CC_SD_DOM",
      SD_GLO: "CC_SD_GLO",
      MKTG: "CC_MKTG",
      RND: "CC_RND",
      PP_PLT: "CC_PP_PLT",
      QM_QC: "CC_QM_QC",
      QM_QA: "CC_QM_QA",
      MM_LOG: "CC_MM_LOC",
      PLAN: "CC_PLAN",
      HR: "CC_HR",
      FIN: "CC_FIN",
      ACCT: "CC_ACCT",
    };

    function _date(v) {
      if (!v) return "";
      var d;
      if (v instanceof Date) {
        d = v;
      } else {
        var m = String(v).match(/\/Date\((\d+)\)\//);
        if (m) {
          d = new Date(parseInt(m[1], 10));
        } else if (/^\d{8}$/.test(String(v))) {
          return v.slice(0, 4) + "." + v.slice(4, 6) + "." + v.slice(6, 8);
        } else {
          return String(v);
        }
      }
      return (
        d.getUTCFullYear() +
        "." +
        ("0" + (d.getUTCMonth() + 1)).slice(-2) +
        "." +
        ("0" + d.getUTCDate()).slice(-2)
      );
    }

    function _amt(n, w) {
      var f = parseFloat(n);
      if (!f) return "-";
      return Math.round(f).toLocaleString("ko-KR") + " " + (w || "KRW");
    }

    function _toDate(s) {
      if (!s) return null;
      var c = s.replace(/[.\-]/g, "");
      if (!/^\d{8}$/.test(c)) return null;
      return new Date(
        Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8)),
      );
    }

    function _toODataDate(s) {
      var d = _toDate(s);
      if (!d) return null;
      return "/Date(" + d.getTime() + ")/";
    }

    function _rawDate(raw) {
      if (!raw) return null;
      if (raw instanceof Date) return raw;
      var m = String(raw).match(/\/Date\((\d+)\)\//);
      return m ? new Date(+m[1]) : null;
    }

    function _today() {
      var d = new Date();
      return (
        d.getFullYear() +
        "년 " +
        String(d.getMonth() + 1).padStart(2, "0") +
        "월 " +
        String(d.getDate()).padStart(2, "0") +
        "일"
      );
    }

    function _dateKo(v) {
      return _date(v);
    }

    var _EMPTY_FORM = function () {
      return {
        Pernr: "",
        Pernam: "",
        Btrtl: "",
        Grade: "SA",
        Eindt: "",
        RetireYn: "N",
        Betrg: "",
        Begda: "",
        Kostl: "",
      };
    };

    return Controller.extend(
      "ze3fiemployee.ze3fiemployee.controller.EmployeeView",
      {
        onInit: function () {
          this.getView().setModel(
            new JSONModel({
              busy: false,
              allItems: [],
              listItems: [],
              pagedItems: [],
              countText: "",
              page: 1,
              totalPages: 1,
              pageInfo: "",
              hasPrev: false,
              hasNext: false,
              selectedRetire: "",
              selectedGrade: "",
              gradeItems: [
                { key: "", text: "직급 전체" },
                { key: "SA", text: "사원" },
                { key: "DR", text: "대리" },
                { key: "GJ", text: "과장" },
                { key: "BJ", text: "부장" },
                { key: "DI", text: "이사" },
                { key: "IM", text: "대표" },
              ],
              selectedBtrtl: "",
              searchQuery: "",
              sortByDept: false,
              kpi: {
                total: "0",
                active: "0",
                retired: "0",
                totalSalary: "-",
                deptSalary: [],
                gradeSalary: [],
              },
              chartProps: {
                title: { visible: false },
                legend: { visible: false },
                general: {
                  background: { color: "transparent" },
                  frame: { border: { visible: false } },
                },
                plotArea: {
                  colorPalette: [
                    "#003d7a",
                    "#0a4f96",
                    "#1060b0",
                    "#1872cc",
                    "#2085e8",
                    "#3595ef",
                    "#4da4f4",
                    "#67b5f6",
                    "#82c5f8",
                    "#9dd5fa",
                    "#b7e4fc",
                    "#cceefe",
                    "#dff5ff",
                    "#f0faff",
                  ],
                  gridline: { visible: false },
                  dataLabel: {
                    visible: true,
                    hideWhenOverlap: true,
                    formatString: "#,##0",
                    style: { fontSize: "11px", color: "#32363a" },
                  },
                },
                valueAxis: {
                  title: { visible: true, text: "급여합계 (백만원)" },
                  label: { formatString: "#,##0" },
                },
                categoryAxis: {
                  title: { visible: false },
                  label: { truncatedLabelRatio: 0.3 },
                },
              },
              mode: "CREATE",
              form: _EMPTY_FORM(),
              salaryTitle: "",
              salaryForm: {
                _pernr: "",
                Betrg: "",
                Begda: "",
                Kostl: "",
              },
            }),
            "view",
          );

          this.getView().setModel(
            new JSONModel({
              Pernr: "",
              Pernam: "",
              Btrtl: "",
              Grade: "",
              Eindt: "",
              Begda: "",
              Endda: "",
              BetrFormatted: "",
              Kostl: "",
              PhotoSrc: "",
              ContractDate: "",
            }),
            "contract",
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

        // ── 전체 조회 ─────────────────────────────────────────────
        _loadAll: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/busy", true);
          this.getOwnerComponent()
            .getModel()
            .read("/EmployeeSet", {
              success: function (d) {
                var aAll = (d.results || []).map(function (r) {
                  return {
                    Pernr: r.Pernr,
                    Pernam: r.Pernam,
                    Btrtl: (r.Btrtl || "").trim(),
                    BtrtlName: BTRTL[(r.Btrtl || "").trim()] || r.Btrtl || "",
                    Grade: (r.Grade || "").trim(),
                    GradeName: GRADE[(r.Grade || "").trim()] || r.Grade || "",
                    EindtFmt: _dateKo(r.Eindt),
                    RetireYn: (r.RetireYn || "N").trim(),
                    Betrg: r.Betrg,
                    Waers: r.Waers || "KRW",
                    BetrFmt: _amt(r.Betrg, r.Waers),
                    BegdaFmt: _date(r.Begda),
                    EnddaFmt: _date(r.Endda),
                    Kostl: r.Kostl || "",
                    _Eindt: r.Eindt,
                    _Begda: r.Begda,
                    _Endda: r.Endda,
                  };
                });
                oVM.setProperty("/allItems", aAll);
                oVM.setProperty("/busy", false);
                this._computeKpi(aAll);
                this._updateGradeItems(oVM, oVM.getProperty("/selectedBtrtl"));
                this._applyFilter();
              }.bind(this),
              error: function () {
                oVM.setProperty("/busy", false);
                MessageBox.error("사원 데이터 조회 실패");
              },
            });
        },

        _computeKpi: function (a) {
          var oVM = this.getView().getModel("view");
          var aActive = a.filter(function (r) {
            return r.RetireYn !== "Y";
          });

          oVM.setProperty("/kpi/total", String(a.length));
          oVM.setProperty("/kpi/active", String(aActive.length));
          oVM.setProperty(
            "/kpi/retired",
            String(
              a.filter(function (r) {
                return r.RetireYn === "Y";
              }).length,
            ),
          );

          // 재직 사원 기준 총 급여합계
          var nTotal = aActive.reduce(function (sum, r) {
            return sum + (parseFloat(r.Betrg) || 0);
          }, 0);
          oVM.setProperty(
            "/kpi/totalSalary",
            nTotal > 0 ? Math.round(nTotal).toLocaleString("ko-KR") : "-",
          );

          // 부서별 급여합계 (재직 기준, 급여 내림차순)
          var oDept = {};
          aActive.forEach(function (r) {
            if (!r.Btrtl) return;
            if (!oDept[r.Btrtl]) {
              oDept[r.Btrtl] = {
                name: BTRTL[r.Btrtl] || r.Btrtl,
                count: 0,
                salary: 0,
              };
            }
            oDept[r.Btrtl].count++;
            oDept[r.Btrtl].salary += parseFloat(r.Betrg) || 0;
          });
          var aDept = Object.keys(oDept)
            .sort(function (a, b) {
              return oDept[b].salary - oDept[a].salary;
            })
            .map(function (k, idx) {
              var raw = Math.round(oDept[k].salary);
              var avg =
                oDept[k].count > 0 ? Math.round(raw / oDept[k].count) : 0;
              var pctNum =
                nTotal > 0 ? parseFloat(((raw / nTotal) * 100).toFixed(1)) : 0;
              return {
                name: oDept[k].name,
                count: String(oDept[k].count),
                salary: raw.toLocaleString("ko-KR"),
                salaryRaw: raw,
                salaryM: Math.round(raw / 1000000),
                avgSalary: avg.toLocaleString("ko-KR"),
                pct: pctNum.toFixed(1) + "%",
                pctNum: pctNum,
                highlight: idx === 0 ? "Success" : idx < 3 ? "Warning" : "None",
              };
            });
          oVM.setProperty("/kpi/deptSalary", aDept);

          // 직급별 급여합계 (재직 기준)
          var GRADE = {
            SA: "사원",
            DR: "대리",
            GJ: "과장",
            BJ: "부장",
            DI: "이사",
            IM: "대표",
          };
          var GRADE_ORDER = ["IM", "DI", "BJ", "GJ", "DR", "SA"];
          var oGrade = {};
          aActive.forEach(function (r) {
            var g = r.Grade || "??";
            if (!oGrade[g]) {
              oGrade[g] = { name: GRADE[g] || g, count: 0, salary: 0 };
            }
            oGrade[g].count++;
            oGrade[g].salary += parseFloat(r.Betrg) || 0;
          });
          var aGrade = GRADE_ORDER.filter(function (k) {
            return oGrade[k];
          }).map(function (k) {
            var raw = Math.round(oGrade[k].salary);
            var avg =
              oGrade[k].count > 0 ? Math.round(raw / oGrade[k].count) : 0;
            var pctNum =
              nTotal > 0 ? parseFloat(((raw / nTotal) * 100).toFixed(1)) : 0;
            return {
              name: oGrade[k].name,
              count: String(oGrade[k].count),
              salary: raw.toLocaleString("ko-KR"),
              salaryRaw: raw,
              avgSalary: avg.toLocaleString("ko-KR"),
              pct: pctNum.toFixed(1) + "%",
              pctNum: pctNum,
            };
          });
          oVM.setProperty("/kpi/gradeSalary", aGrade);
        },

        _applyFilter: function () {
          var oVM = this.getView().getModel("view");
          var aAll = oVM.getProperty("/allItems") || [];
          var sR = oVM.getProperty("/selectedRetire");
          var sG = oVM.getProperty("/selectedGrade");
          var sQ = (oVM.getProperty("/searchQuery") || "").trim().toLowerCase();

          var sB = oVM.getProperty("/selectedBtrtl");

          var a = aAll;
          if (sR)
            a = a.filter(function (r) {
              return r.RetireYn === sR;
            });
          if (sG)
            a = a.filter(function (r) {
              return r.Grade === sG;
            });
          if (sB)
            a = a.filter(function (r) {
              return r.Btrtl === sB;
            });
          if (sQ)
            a = a.filter(function (r) {
              return (
                r.Pernr.toLowerCase().includes(sQ) ||
                r.Pernam.toLowerCase().includes(sQ)
              );
            });

          if (oVM.getProperty("/sortByDept")) {
            var DEPT_ORDER = [
              "MGMT",
              "SD_DOM",
              "SD_GLO",
              "MKTG",
              "RND",
              "PP_PLT",
              "QM_QC",
              "QM_QA",
              "MM_LOG",
              "PLAN",
              "HR",
              "FIN",
              "ACCT",
            ];
            var GRADE_ORDER_S = ["IM", "DI", "BJ", "GJ", "DR", "SA"];
            a = a.slice().sort(function (x, y) {
              var d = DEPT_ORDER.indexOf(x.Btrtl) - DEPT_ORDER.indexOf(y.Btrtl);
              return d !== 0
                ? d
                : GRADE_ORDER_S.indexOf(x.Grade) -
                    GRADE_ORDER_S.indexOf(y.Grade);
            });
          }

          oVM.setProperty("/listItems", a);
          oVM.setProperty("/countText", a.length + " 건");
          oVM.setProperty("/page", 1);
          this._paginate(oVM, a);
        },

        _paginate: function (oVM, aList) {
          var PAGE_SIZE = 15;
          var nTotal = aList.length;
          var nPage = oVM.getProperty("/page") || 1;
          var nPages = Math.max(1, Math.ceil(nTotal / PAGE_SIZE));
          if (nPage > nPages) nPage = nPages;
          var nStart = (nPage - 1) * PAGE_SIZE;
          oVM.setProperty(
            "/pagedItems",
            aList.slice(nStart, nStart + PAGE_SIZE),
          );
          oVM.setProperty("/page", nPage);
          oVM.setProperty("/totalPages", nPages);
          oVM.setProperty(
            "/pageInfo",
            nPage + " / " + nPages + " 페이지  (" + nTotal + "건)",
          );
          oVM.setProperty("/hasPrev", nPage > 1);
          oVM.setProperty("/hasNext", nPage < nPages);
        },

        onPagePrev: function () {
          var oVM = this.getView().getModel("view");
          var n = oVM.getProperty("/page");
          if (n <= 1) return;
          oVM.setProperty("/page", n - 1);
          this._paginate(oVM, oVM.getProperty("/listItems") || []);
        },

        onPageNext: function () {
          var oVM = this.getView().getModel("view");
          var n = oVM.getProperty("/page");
          if (n >= oVM.getProperty("/totalPages")) return;
          oVM.setProperty("/page", n + 1);
          this._paginate(oVM, oVM.getProperty("/listItems") || []);
        },

        onRetireChange: function (oEvent) {
          this.getView()
            .getModel("view")
            .setProperty(
              "/selectedRetire",
              oEvent.getSource().getSelectedKey(),
            );
          this._applyFilter();
        },
        onGradeChange: function (oEvent) {
          this.getView()
            .getModel("view")
            .setProperty("/selectedGrade", oEvent.getSource().getSelectedKey());
          this._applyFilter();
        },
        onBtrtlChange: function (oEvent) {
          var oVM = this.getView().getModel("view");
          var sBtrtl = oEvent.getSource().getSelectedKey();
          oVM.setProperty("/selectedBtrtl", sBtrtl);
          oVM.setProperty("/selectedGrade", "");
          this._updateGradeItems(oVM, sBtrtl);
          this._applyFilter();
        },

        onBtrtlDialogChange: function (oEvent) {
          var oVM = this.getView().getModel("view");
          var sBtrtl = oEvent.getSource().getSelectedKey();
          oVM.setProperty("/form/Kostl", KOSTL_MAP[sBtrtl] || "");
        },

        onGradeDialogChange: function (oEvent) {
          var sGrade = oEvent.getSource().getSelectedKey();
          var sSalary = GRADE_SALARY[sGrade];
          if (sSalary) {
            this.getView().getModel("view").setProperty("/form/Betrg", sSalary);
          }
        },

        fmtSalaryDisplay: function (v) {
          var n = parseFloat(v);
          if (!n) return "";
          return Math.round(n).toLocaleString("ko-KR");
        },

        onEindtChange: function (oEvent) {
          var sVal = oEvent.getSource().getValue();
          var sBegda = this._calcBegda(sVal);
          if (sBegda) {
            this.getView().getModel("view").setProperty("/form/Begda", sBegda);
          }
        },

        _calcBegda: function (sEindt) {
          var c = (sEindt || "").replace(/[.\-]/g, "");
          if (!/^\d{8}$/.test(c)) return "";
          var y = +c.slice(0, 4);
          var m = +c.slice(4, 6);
          var d = +c.slice(6, 8);
          if (d > 25) {
            m += 1;
            if (m > 12) {
              m = 1;
              y += 1;
            }
          }
          return y + ("0" + m).slice(-2) + "25";
        },

        _updateGradeItems: function (oVM, sBtrtl) {
          var GRADE_ORDER = ["SA", "DR", "GJ", "BJ", "DI", "IM"];
          var aAll = oVM.getProperty("/allItems") || [];
          var aSrc = sBtrtl
            ? aAll.filter(function (r) {
                return r.Btrtl === sBtrtl;
              })
            : aAll;
          var seen = {};
          aSrc.forEach(function (r) {
            if (r.Grade) seen[r.Grade] = true;
          });
          var aItems = [{ key: "", text: "직급 전체" }];
          GRADE_ORDER.forEach(function (k) {
            if (seen[k] && GRADE[k]) aItems.push({ key: k, text: GRADE[k] });
          });
          oVM.setProperty("/gradeItems", aItems);
        },
        onSortToggle: function () {
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/sortByDept", !oVM.getProperty("/sortByDept"));
          this._applyFilter();
        },

        onSearch: function (oEvent) {
          this.getView()
            .getModel("view")
            .setProperty(
              "/searchQuery",
              oEvent.getParameter("newValue") ||
                oEvent.getParameter("value") ||
                "",
            );
          this._applyFilter();
        },

        // ── 등록 ─────────────────────────────────────────────────
        onNewCreate: function () {
          var oVM = this.getView().getModel("view");
          var aAll = oVM.getProperty("/allItems") || [];
          var nMax = aAll.reduce(function (mx, r) {
            var n = parseInt(r.Pernr, 10);
            return isNaN(n) ? mx : Math.max(mx, n);
          }, 0);
          var oForm = _EMPTY_FORM();
          oForm.Pernr = String(nMax + 1).padStart(8, "0");
          oForm.Betrg = GRADE_SALARY[oForm.Grade] || "";
          oVM.setProperty("/mode", "CREATE");
          oVM.setProperty("/form", oForm);
          this.byId("empDialog").open();
        },

        // ── 수정 ─────────────────────────────────────────────────
        onEditPress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/mode", "EDIT");
          var sBtrtl = oRow.Btrtl || "FI";
          oVM.setProperty("/form", {
            Pernr: oRow.Pernr,
            Pernam: oRow.Pernam,
            Btrtl: sBtrtl,
            Grade: oRow.Grade || "P1",
            Eindt: _date(oRow._Eindt).replace(/[.\-]/g, ""),
            RetireYn: oRow.RetireYn || "N",
            Betrg: oRow.Betrg ? String(Math.round(parseFloat(oRow.Betrg))) : "",
            Waers: oRow.Waers || "KRW",
            Begda: (oRow.BegdaFmt || "").replace(/-/g, ""),
            Kostl: KOSTL_MAP[sBtrtl] || oRow.Kostl || "",
          });
          this.byId("empDialog").open();
        },

        // ── 저장 ─────────────────────────────────────────────────
        onSave: function () {
          var oVM = this.getView().getModel("view");
          var oF = oVM.getProperty("/form");
          var sMode = oVM.getProperty("/mode");

          if (!oF.Pernr || !oF.Pernam || !oF.Eindt) {
            MessageToast.show("사원번호, 성명, 입사일은 필수입니다.");
            return;
          }

          var oBody = {
            Pernr: oF.Pernr,
            Pernam: oF.Pernam,
            Btrtl: oF.Btrtl,
            Grade: oF.Grade,
            Eindt: _toODataDate(oF.Eindt),
            Betrg: (parseFloat(oF.Betrg) || 0).toFixed(3),
            Waers: "KRW",
            Begda: _toODataDate(oF.Begda),
            Endda: _toODataDate("99991231"),
            Kostl: oF.Kostl || "",
          };
          if (sMode === "EDIT") {
            oBody.ApproverYn = false;
            oBody.RetireYn = oF.RetireYn || "N";
          }

          var oModel = this.getOwnerComponent().getModel();
          var fnOk = function () {
            MessageToast.show(
              sMode === "CREATE" ? "등록되었습니다." : "수정되었습니다.",
            );
            this.byId("empDialog").close();
            this._loadAll();
          }.bind(this);
          var fnErr = function (e) {
            var s = "저장 실패";
            try {
              s += ": " + JSON.parse(e.responseText).error.message.value;
            } catch (x) {}
            MessageBox.error(s);
          };

          if (sMode === "CREATE") {
            oModel.create("/EmployeeSet", oBody, {
              success: fnOk,
              error: fnErr,
            });
          } else {
            oModel.update("/EmployeeSet('" + oF.Pernr + "')", oBody, {
              success: fnOk,
              error: fnErr,
            });
          }
        },

        onCloseEmpDialog: function () {
          this.byId("empDialog").close();
        },

        // ── 삭제 ─────────────────────────────────────────────────
        onDeletePress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          MessageBox.confirm("[" + oRow.Pernam + "] 사원을 삭제하시겠습니까?", {
            title: "삭제 확인",
            onClose: function (sAction) {
              if (sAction !== MessageBox.Action.OK) return;
              this.getOwnerComponent()
                .getModel()
                .remove("/EmployeeSet('" + oRow.Pernr + "')", {
                  success: function () {
                    MessageToast.show("삭제되었습니다.");
                    this._loadAll();
                  }.bind(this),
                  error: function (e) {
                    var s = "삭제 실패";
                    try {
                      s +=
                        ": " + JSON.parse(e.responseText).error.message.value;
                    } catch (x) {}
                    MessageBox.error(s);
                  },
                });
            }.bind(this),
          });
        },

        // ── 급여 설정 ─────────────────────────────────────────────
        onSalaryPress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          var oVM = this.getView().getModel("view");
          oVM.setProperty("/salaryTitle", "[" + oRow.Pernam + "] 급여 설정");
          oVM.setProperty("/salaryForm", {
            _pernr: oRow.Pernr,
            Betrg: oRow.Betrg ? String(Math.round(parseFloat(oRow.Betrg))) : "",
            Begda: (oRow.BegdaFmt || "").replace(/-/g, ""),
            Kostl: KOSTL_MAP[oRow.Btrtl] || oRow.Kostl || "",
          });
          this.byId("salaryDialog").open();
        },

        onSaveSalary: function () {
          var oVM = this.getView().getModel("view");
          var oSal = oVM.getProperty("/salaryForm");
          if (!oSal.Betrg) {
            MessageToast.show("기본급을 입력하세요.");
            return;
          }

          var oEmp = (oVM.getProperty("/allItems") || []).find(function (r) {
            return r.Pernr === oSal._pernr;
          });
          if (!oEmp) {
            MessageBox.error("사원 정보를 찾을 수 없습니다.");
            return;
          }

          var oBody = {
            Pernr: oEmp.Pernr,
            Pernam: oEmp.Pernam,
            Btrtl: oEmp.Btrtl,
            Grade: oEmp.Grade,
            Eindt: _rawDate(oEmp._Eindt)
              ? "/Date(" + _rawDate(oEmp._Eindt).getTime() + ")/"
              : null,
            RetireYn: oEmp.RetireYn,
            ApproverYn: false,
            Betrg: (parseFloat(oSal.Betrg) || 0).toFixed(3),
            Waers: "KRW",
            Begda: _toODataDate(oSal.Begda),
            Endda: _rawDate(oEmp._Endda)
              ? "/Date(" + _rawDate(oEmp._Endda).getTime() + ")/"
              : _toODataDate("99991231"),
            Kostl: oSal.Kostl || "",
          };

          this.getOwnerComponent()
            .getModel()
            .update("/EmployeeSet('" + oSal._pernr + "')", oBody, {
              success: function () {
                MessageToast.show("급여 정보가 저장되었습니다.");
                this.byId("salaryDialog").close();
                this._loadAll();
              }.bind(this),
              error: function (e) {
                var s = "저장 실패";
                try {
                  s += ": " + JSON.parse(e.responseText).error.message.value;
                } catch (x) {}
                MessageBox.error(s);
              },
            });
        },

        onCloseSalaryDialog: function () {
          this.byId("salaryDialog").close();
        },

        // ── 근로계약서 ────────────────────────────────────────────
        onContractPress: function (oEvent) {
          var oRow = oEvent.getSource().getBindingContext("view").getObject();
          var sBetr = "";
          if (oRow.Betrg && parseFloat(oRow.Betrg) > 0) {
            sBetr =
              Math.round(parseFloat(oRow.Betrg)).toLocaleString("ko-KR") +
              "  " +
              (oRow.Waers || "KRW");
          }
          var sEnd = oRow.EnddaFmt;
          if (sEnd && sEnd.startsWith("9999")) sEnd += "  (무기한)";

          var oCon = this.getView().getModel("contract");
          oCon.setData({
            Pernr: oRow.Pernr,
            Pernam: oRow.Pernam,
            Btrtl: oRow.BtrtlName,
            Grade: oRow.GradeName,
            Eindt: oRow.EindtFmt,
            Begda: oRow.BegdaFmt,
            Endda: sEnd,
            BetrFormatted: sBetr,
            Kostl: oRow.Kostl,
            PhotoSrc: oCon.getProperty("/PhotoSrc"),
            ContractDate: _today(),
          });
          this._openContractDialog();
        },

        _openContractDialog: function () {
          var oView = this.getView();
          if (!this._pContractDialog) {
            this._pContractDialog = Fragment.load({
              id: oView.getId(),
              name: "ze3fiemployee.ze3fiemployee.view.ContractDialog",
              controller: this,
            }).then(function (oDialog) {
              oView.addDependent(oDialog);
              return oDialog;
            });
          }
          this._pContractDialog.then(function (oDialog) {
            oDialog.open();
          });
        },

        onPhotoUpload: function () {
          var oCon = this.getView().getModel("contract");
          var oInput = document.createElement("input");
          oInput.type = "file";
          oInput.accept = "image/*";
          oInput.addEventListener("change", function (e) {
            var oFile = e.target.files[0];
            if (!oFile) return;
            var oReader = new FileReader();
            oReader.onload = function (ev) {
              oCon.setProperty("/PhotoSrc", ev.target.result);
            };
            oReader.readAsDataURL(oFile);
          });
          oInput.click();
        },

        onPrint: function () {
          window.print();
        },
        onCloseDialog: function () {
          this._pContractDialog.then(function (oDialog) {
            oDialog.close();
          });
        },
      },
    );
  },
);
