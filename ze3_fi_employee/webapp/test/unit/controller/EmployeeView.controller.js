/*global QUnit*/

sap.ui.define([
	"ze3fiemployee/ze3fiemployee/controller/EmployeeView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("EmployeeView Controller");

	QUnit.test("I should test the EmployeeView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
