/** @odoo-module **/

/* ---------------------------------------------------------
+ * Odoo cmis_web
+ * Authors Laurent Mignon 2016, Quentin Groulard 2023 Acsone SA/NV
+ * License in __openerp__.py at root level of the module
+ *---------------------------------------------------------
+*/

import {Dialog} from "@web/core/dialog/dialog";

const {Component, useRef} = owl;

export class AddDocumentDialog extends Component {
    setup() {
        this.filesInput = useRef("filesInput");
    }

    onClose() {
        this.props.close();
    }

    async onConfirm() {
        const files = this.filesInput.el?.files;

        try {
            await this.props.confirm(files);
            this.props.close();
        } catch (e) {
            this.props.close();
            throw e;
        }
    }
}

AddDocumentDialog.components = { Dialog };
AddDocumentDialog.template = "cmis_web.AddDocumentDialog";
AddDocumentDialog.props = {
    confirm: Function,
    close: Function,
};
