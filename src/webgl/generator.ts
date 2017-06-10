import { convertTypeName, convertConstant } from "./types";
import { generateIntrinsicFunction } from "./intrinsics";
import { Specification } from "stardust-core";
import { Binding } from "stardust-core";
import { Dictionary } from "stardust-core";

export enum GenerateMode {
    NORMAL   = 0,
    PICK     = 1,
    FRAGMENT = 2
}


export enum ViewType {
    VIEW_2D = 0,
    VIEW_3D = 1,      // 3D mode.
    VIEW_WEBVR = 2    // WebVR mode.
}


export class CodeGenerator {
    private _mode: GenerateMode;
    private _viewType: ViewType;

    private _additionalCodes: string[];
    private _lines: string[];
    private _currentIndent: string;
    private _hasColor: boolean;
    private _hasNormal: boolean;
    private _positionType: string;

    constructor(viewType: ViewType, mode: GenerateMode = GenerateMode.NORMAL) {
        this._mode = mode;
        this._viewType = viewType;
        this._lines = [];
        this._additionalCodes = [];
        this._currentIndent = "";
        this._hasColor = false;
    }

    public addLine(code: string) {
        this._lines.push(this._currentIndent + code);
    }

    public addAdditionalCode(code: string) {
        if(this._additionalCodes.indexOf(code) < 0) {
            this._additionalCodes.push(code);
        }
    }

    public indent() {
        this._currentIndent += "    ";
    }

    public unindent() {
        this._currentIndent = this._currentIndent.slice(0, this._currentIndent.length - 4);
    }

    public addDeclaration(name: string, type: string) {
        this.addLine(`${convertTypeName(type)} ${name};`);
    }

    public addUniform(name: string, type: string) {
        this.addLine(`uniform ${convertTypeName(type)} ${name};`);
        if(type == "Vector2Array" || type == "FloatArray" || type == "Vector3Array" || type == "Vector4Array") {
            this.addLine(`uniform int ${name}_length;`);
        }
    }

    public addAttribute(name: string, type: string) {
        this.addLine(`attribute ${convertTypeName(type)} ${name};`);
    }

    public addVarying(name: string, type: string) {
        this.addLine(`varying ${convertTypeName(type)} ${name};`);
        if(name == "out_position") {
            this._positionType = type;
        }
        if(name == "out_color") {
            this._hasColor = true;
        }
        if(name == "out_normal") {
            this._hasNormal = true;
        }
    }

    public generateExpression(expr: Specification.Expression): string {
        switch(expr.type) {
            case "constant": {
                let eConstant = expr as Specification.ExpressionConstant;
                return convertConstant(eConstant.valueType, eConstant.value);
            }
            case "variable": {
                let eVariable = expr as Specification.ExpressionVariable;
                return eVariable.variableName;
            }
            case "function": {
                let eFunction = expr as Specification.ExpressionFunction;
                let args = eFunction.arguments.map((arg) => this.generateExpression(arg));
                let { code, additionalCode } = generateIntrinsicFunction(eFunction.functionName, args);
                if(additionalCode != null) {
                    this.addAdditionalCode(additionalCode);
                }
                return code;
            }
            case "field": {
                let eField = expr as Specification.ExpressionField;
                return `${this.generateExpression(eField.value)}.${eField.fieldName}`;
            }
        }
    }

    public addStatement(stat: Specification.Statement) {
        switch(stat.type) {
            case "assign": {
                let sAssign = stat as Specification.StatementAssign;
                let expr = this.generateExpression(sAssign.expression)
                this.addLine(`${sAssign.variableName} = ${expr};`);
            } break;
            case "condition": {
                let sCondition = stat as Specification.StatementCondition;
                if(sCondition.trueStatements.length > 0 && sCondition.falseStatements.length > 0) {
                    this.addLine(`if(${this.generateExpression(sCondition.condition)}) {`);
                    this.indent();
                    this.addStatements(sCondition.trueStatements);
                    this.unindent();
                    this.addLine(`} else {`);
                    this.indent();
                    this.addStatements(sCondition.falseStatements);
                    this.unindent();
                    this.addLine(`}`);
                } else if(sCondition.trueStatements.length > 0) {
                    this.addLine(`if(${this.generateExpression(sCondition.condition)}) {`);
                    this.indent();
                    this.addStatements(sCondition.trueStatements);
                    this.unindent();
                    this.addLine(`}`);
                } else if(sCondition.falseStatements.length > 0) {
                    this.addLine(`if(!${this.generateExpression(sCondition.condition)}) {`);
                    this.indent();
                    this.addStatements(sCondition.trueStatements);
                    this.unindent();
                    this.addLine(`}`);
                }
            } break;
            case "for": {
                let sForLoop = stat as Specification.StatementForLoop;
                this.addLine(`for(int ${sForLoop.variableName} = ${sForLoop.rangeMin}; ${sForLoop.variableName} <= ${sForLoop.rangeMax}; ${sForLoop.variableName}++) {`);
                this.indent();
                this.addStatements(sForLoop.statements);
                this.unindent();
                this.addLine(`}`);
            } break;
            case "emit": {
                let sEmit = stat as Specification.StatementEmit;
                if(this._mode == GenerateMode.FRAGMENT) {
                    for(let name in sEmit.attributes) {
                        this.addLine(`fout_${name} = ${this.generateExpression(sEmit.attributes[name])};`);
                    }
                } else {
                    for(let name in sEmit.attributes) {
                        this.addLine(`out_${name} = ${this.generateExpression(sEmit.attributes[name])};`);
                    }
                }
                if(this._mode == GenerateMode.PICK) {
                    this.addLine(`out_pick_index = vec4(s3_pick_index.rgb, s3_pick_index_alpha);`);
                }
                if(this._mode == GenerateMode.FRAGMENT) {
                    this.addLine("gl_FragColor = fout_color;");
                } else {
                    switch(this._positionType) {
                        case "Vector2": {
                            this.addLine("gl_Position = s3_render_vertex(vec3(out_position, 0.0));");
                        } break;
                        case "Vector3": {
                            this.addLine("gl_Position = s3_render_vertex(out_position);");
                        } break;
                        case "Vector4": {
                            this.addLine("gl_Position = s3_render_vertex(out_position.xyz);");
                        } break;
                    }
                }
            } break;
        }
    }

    public addStatements(stat: Specification.Statement[]) {
        stat.forEach((s) => this.addStatement(s));
    }

    public getCode(): string {
        return this._lines.map((line) => {
            if(line.trim() == "@additionalCode") return this._additionalCodes.join("\n");
            return line;
        }).join("\n");
    }
}

export class Generator {

    private _mode: GenerateMode;
    private _viewType: ViewType;

    private _vertexCode: string;
    private _fragmentCode: string;

    constructor(viewType: ViewType, mode: GenerateMode = GenerateMode.NORMAL) {
        this._mode = mode;
        this._viewType = viewType;
    }

    public compileVertexShader(spec: Specification.Mark, asUniform: (name: string) => boolean): CodeGenerator {
        let gen = new CodeGenerator(this._viewType, this._mode);

        gen.addLine("precision highp float;");
        // Global attributes.
        for(let name in spec.input) {
            if(spec.input.hasOwnProperty(name)) {
                if(asUniform(name)) {
                    gen.addUniform(name, spec.input[name].type);
                } else {
                    gen.addAttribute(name, spec.input[name].type);
                }
            }
        }
        if(this._mode == GenerateMode.PICK) {
            gen.addAttribute("s3_pick_index", "Vector4");
            gen.addUniform("s3_pick_index_alpha", "float");
        }
        switch(this._viewType) {
            case ViewType.VIEW_2D: {
                gen.addUniform("s3_view_params", "Vector4");
                gen.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        return vec4(p.xy * s3_view_params.xy + s3_view_params.zw, 0.0, 1.0);
                    }
                `);
            } break;
            case ViewType.VIEW_3D: {
                gen.addUniform("s3_view_params", "Vector4");
                gen.addUniform("s3_view_position", "Vector3");
                gen.addUniform("s3_view_rotation", "Vector4");
                gen.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        // Get position in view coordinates:
                        //   v = quaternion_inverse_rotate(rotation, p - position)
                        vec3 v = p - s3_view_position;
                        float d = dot(s3_view_rotation.xyz, v);
                        vec3 c = cross(s3_view_rotation.xyz, v);
                        v = s3_view_rotation.w * s3_view_rotation.w * v - (s3_view_rotation.w + s3_view_rotation.w) * c + d * s3_view_rotation.xyz - cross(c, s3_view_rotation.xyz);
                        // Compute projection.
                        vec4 r;
                        r.xy = v.xy * s3_view_params.xy;
                        r.z = v.z * s3_view_params.z + s3_view_params.w;
                        r.w = -v.z;
                        return r;
                    }
                `)
            } break;
            case ViewType.VIEW_WEBVR: {
                // For WebVR, we use the MVP matrix provided by it.
                gen.addUniform("s3_projection_matrix", "Matrix4");
                gen.addUniform("s3_view_matrix", "Matrix4");
                gen.addUniform("s3_view_position", "Vector3");
                gen.addUniform("s3_view_rotation", "Vector4");
                gen.addAdditionalCode(`
                    vec4 s3_render_vertex(vec3 p) {
                        vec3 v = p - s3_view_position;
                        float d = dot(s3_view_rotation.xyz, v);
                        vec3 c = cross(s3_view_rotation.xyz, v);
                        v = s3_view_rotation.w * s3_view_rotation.w * v - (s3_view_rotation.w + s3_view_rotation.w) * c + d * s3_view_rotation.xyz - cross(c, s3_view_rotation.xyz);
                        return s3_projection_matrix * s3_view_matrix * vec4(v, 1);
                    }
                `)
            } break;
        }
        gen.addLine("@additionalCode");
        // Output attributes.
        for(let name in spec.output) {
            if(spec.output.hasOwnProperty(name)) {
                gen.addVarying("out_" + name, spec.output[name].type);
            }
        }
        if(this._mode == GenerateMode.PICK) {
            gen.addVarying("out_pick_index", "Vector4");
        }
        // The main function.
        gen.addLine("void main() {");
        gen.indent();
        // Define arguments.
        for(let name in spec.variables) {
            if(spec.variables.hasOwnProperty(name)) {
                let type = spec.variables[name];
                gen.addDeclaration(name, type);
            }
        }
        gen.addStatements(spec.statements);
        gen.unindent();
        gen.addLine("}");

        return gen;
    }

    public compileFragmentShader(mspec: Specification.Mark, spec: Specification.Shader, asUniform: (name: string) => boolean): CodeGenerator {
        let gen = new CodeGenerator(this._viewType, GenerateMode.FRAGMENT);

        gen.addLine("precision highp float;");
        // Global attributes.
        for(let name in spec.input) {
            if(spec.input.hasOwnProperty(name)) {
                if(mspec.output[name]) {
                    gen.addVarying("out_" + name, spec.input[name].type);
                } else {
                    if(asUniform(name)) {
                        gen.addUniform(name, spec.input[name].type);
                    }
                }
            }
        }
        // Output attributes.
        for(let name in spec.output) {
            if(spec.output.hasOwnProperty(name)) {
                gen.addDeclaration("fout_" + name, spec.output[name].type);
            }
        }
        // The main function.
        gen.addLine("void main() {");
        gen.indent();
        // Define arguments.
        for(let name in spec.variables) {
            if(spec.variables.hasOwnProperty(name)) {
                let type = spec.variables[name];
                gen.addDeclaration(name, type);
            }
        }
        for(let name in spec.input) {
            if(spec.input.hasOwnProperty(name)) {
                if(mspec.output[name]) {
                    gen.addLine(`${convertTypeName(spec.input[name].type)} ${name} = out_${name};`);
                } else {
                    gen.addLine(`${convertTypeName(spec.input[name].type)} ${name};`);
                }
            }
        }
        gen.addStatements(spec.statements);
        gen.unindent();
        gen.addLine("}");

        return gen;
    }

    public compileSpecification(spec: Specification.Mark, shader: Specification.Shader, asUniform: (name: string) => boolean) {
        this._vertexCode = this.compileVertexShader(spec, asUniform).getCode();
        if(this._mode == GenerateMode.PICK) {
            this._fragmentCode = `
                precision highp float;
                varying vec4 out_pick_index;
                void main() {
                    gl_FragColor = out_pick_index;
                }
            `;
        } else {
            this._fragmentCode = this.compileFragmentShader(spec, shader, asUniform).getCode();
        }
    }

    public getVertexCode(): string {
        return this._vertexCode;
    }

    public getFragmentCode(): string {
        return this._fragmentCode;
    }
}