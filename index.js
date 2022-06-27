const fs = require('fs');
const { resolve, relative } = require('path');
const { Project, ScriptTarget, SyntaxKind } = require('ts-morph');

// setup new project
const project = new Project({
  compilerOptions: { target: ScriptTarget.ES3 }
});

const args = require('yargs-parser')(process.argv.slice(2));
const srcPath = args._[0] || '.';
const globPath = resolve(srcPath + '/**/*.{tsx,ts,jsx,js,mdx,md}');

console.log(`looking for files matching ${globPath} \n`);
project.addSourceFilesAtPaths(globPath);
console.log(`${project.getSourceFiles().length} files found\n`);

const sourceFiles = project.getSourceFiles();
const data = {
  root: process.cwd(),
  imports: [],
  usage: []
};

sourceFiles.forEach((sourceFile) => {
  try {
    let sourceFileHasPrimerReact = false;
    let importedNames = [];

    // imports
    sourceFile.getDescendantsOfKind(SyntaxKind.ImportDeclaration).forEach((declaration) => {
      if (!declaration.getModuleSpecifierValue().includes('primer/react')) return;

      sourceFileHasPrimerReact = true;

      if (declaration.getDefaultImport()) {
        data.imports.push({
          path: relative(data.root, sourceFile.getFilePath()),
          line_start: declaration.getStartLineNumber(),
          line_end: declaration.getEndLineNumber(),
          name: declaration.getDefaultImport().getText(),
          defaultImport: true,
          specifier: declaration.getModuleSpecifierValue(),
          text: declaration.getFullText()
        });

        // local variable
        importedNames.push(declaration.getDefaultImport().getText());
      } else {
        declaration.getNamedImports().forEach((namedImport) => {
          data.imports.push({
            path: relative(data.root, sourceFile.getFilePath()),
            line_start: declaration.getStartLineNumber(),
            line_end: declaration.getEndLineNumber(),
            name: namedImport.getName(),
            alias: namedImport.getAliasNode() ? namedImport.getAliasNode().getText() : undefined,
            specifier: declaration.getModuleSpecifierValue(),
            text: declaration.getFullText()
          });

          // local variable
          importedNames.push(namedImport.getName());
        });
      }
    });

    if (!sourceFileHasPrimerReact) return;

    // usage: JSX
    sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).forEach((expression) => {
      const tagNameNode = expression.getTagNameNode();

      let tagName, property;
      let attributes = [];

      // simple tag name like <ActionList>
      if (tagNameNode.getKind() === SyntaxKind.Identifier) {
        tagName = tagNameNode.getText(); // example: ActionList
      } else if (tagNameNode.getKind() === SyntaxKind.PropertyAccessExpression) {
        // composite tagName like <ActionList.LeadingVisual>
        tagName = tagNameNode.getExpression().getText(); // example: ActionList
        property = tagNameNode.getName(); // example: LeadingVisual
      }

      expression.getAttributes().forEach((attribute) => {
        if (attribute.getKind() === SyntaxKind.JsxAttribute) {
          const initializer = attribute.getInitializer(); // StringLiteral | JsxExpression | undefined

          attributes.push({
            name: attribute.getName(),
            kind: initializer && initializer.getKindName(),
            text: initializer && initializer.getFullText()
          });
        } else if (attribute.getKind() === SyntaxKind.JsxSpreadAttribute) {
          // TODO: is this information useful?
          attributes.push({
            name: attribute.getKindName(),
            kind: attribute.getKindName(),
            text: attribute.getFullText()
          });
        }
      });

      if (importedNames.includes(tagName)) {
        data.usage.push({
          path: relative(data.root, sourceFile.getFilePath()),
          name: property ? `${tagName}.${property}` : tagName,
          parent: property ? tagName : undefined,
          child: property,
          props: attributes,
          // for meta, get JSXElement instead of just JSXOpeningElement
          line_start: expression.getParent().getStartLineNumber(),
          line_end: expression.getParent().getEndLineNumber(),
          text: expression.getParent().getFullText(),
          type: expression.getKindName()
        });
      }
    });

    // usage: styled(Component)
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((expression) => {
      const [functionName, firstArgument] = expression.getDescendantsOfKind(SyntaxKind.Identifier);
      if (functionName.getText() !== 'styled') return;
      if (!firstArgument) return; // example: styled.div and not styled(Button)

      let componentName, componentChild;

      if (firstArgument.getKind() === SyntaxKind.Identifier) {
        // simple component like styled(Button)
        componentName = firstArgument.getText();
      } else if (firstArgument.getKind() === SyntaxKind.PropertyAccessExpression) {
        // composite component like styled(ActionList.LeadingVisual)
        componentName = firstArgument.getExpression().getText();
        componentChild = firstArgument.getName();
      } else {
        // probably not a component from primer react
      }

      if (importedNames.includes(componentName)) {
        data.usage.push({
          path: relative(data.root, sourceFile.getFilePath()),
          name: componentChild ? `${componentName}.${componentChild}` : componentName,
          parent: componentChild ? componentName : undefined,
          child: componentChild,
          line_start: expression.getStartLineNumber(),
          line_end: expression.getEndLineNumber(),
          text: expression.getParent().getFullText(),
          type: expression.getKindName()
        });
      }
    });

    fs.writeFileSync('./data/data.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(error);
  }
});
